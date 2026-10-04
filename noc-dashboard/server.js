'use strict';

/*
 * PRTG NOC Dashboard - backend
 *
 * Serves the static dashboard from ./public and exposes ONE read-only endpoint
 * (/api/state) that pulls devices + sensors from the PRTG API.
 *
 * Why a backend instead of calling PRTG straight from the browser:
 *   - the PRTG API token never reaches the browser / wall screen
 *   - no CORS problems against the PRTG web server
 *   - fixed queries only: the client cannot make this proxy call arbitrary PRTG URLs
 *   - one cached PRTG query no matter how many screens are open
 *
 * No npm dependencies. Requires Node.js 18+.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

loadEnvFile(path.join(__dirname, '.env'));

const cfg = {
  prtgUrl: (process.env.PRTG_URL || '').replace(/\/+$/, ''),
  apiToken: process.env.PRTG_APITOKEN || '',
  user: process.env.PRTG_USER || '',
  passhash: process.env.PRTG_PASSHASH || '',
  port: toInt(process.env.PORT, 8080),
  bind: process.env.BIND || '0.0.0.0',
  cacheSeconds: toInt(process.env.CACHE_SECONDS, 15),
  timeoutMs: toInt(process.env.PRTG_TIMEOUT_MS, 15000),
  insecureTls: process.env.PRTG_INSECURE_TLS === '1',
  caFile: process.env.PRTG_CA_FILE || '',
  dashUser: process.env.DASH_USER || '',
  dashPass: process.env.DASH_PASS || '',
};

const PUBLIC_DIR = path.join(__dirname, 'public');

const DEVICES_QUERY =
  '/api/table.json?content=devices&output=json&count=50000' +
  '&columns=objid,group,device,host,status,tags,priority';

const SENSORS_QUERY =
  '/api/table.json?content=sensors&output=json&count=50000' +
  '&columns=objid,parentid,group,device,sensor,status,message,lastvalue,priority,tags,downtimesince';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

let tlsCa;
if (cfg.caFile) {
  try {
    tlsCa = fs.readFileSync(cfg.caFile);
  } catch (err) {
    log('error', `Cannot read PRTG_CA_FILE ${cfg.caFile}: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// PRTG API client
// ---------------------------------------------------------------------------

function prtgConfigured() {
  return Boolean(cfg.prtgUrl && (cfg.apiToken || (cfg.user && cfg.passhash)));
}

function withAuth(pathAndQuery) {
  const u = new URL(cfg.prtgUrl + pathAndQuery);
  if (cfg.apiToken) {
    u.searchParams.set('apitoken', cfg.apiToken);
  } else {
    u.searchParams.set('username', cfg.user);
    u.searchParams.set('passhash', cfg.passhash);
  }
  return u;
}

function prtgGet(pathAndQuery) {
  const url = withAuth(pathAndQuery);
  const lib = url.protocol === 'https:' ? https : http;
  const options = {
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeout: cfg.timeoutMs,
  };
  if (url.protocol === 'https:') {
    options.rejectUnauthorized = !cfg.insecureTls;
    if (tlsCa) options.ca = tlsCa;
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new Error(`PRTG rejected credentials (HTTP ${res.statusCode})`));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`PRTG returned HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          // PRTG sometimes answers with an HTML login/error page instead of JSON
          reject(new Error('PRTG returned non-JSON response (check URL / credentials)'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`PRTG request timed out after ${cfg.timeoutMs} ms`)));
    req.on('error', (err) => reject(new Error(`PRTG request failed: ${err.message}`)));
    req.end();
  });
}

function stripHtml(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function splitTags(t) {
  return String(t || '').split(/[\s,]+/).filter(Boolean);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapDevice(d) {
  return {
    id: num(d.objid, 0),
    name: stripHtml(d.device),
    group: stripHtml(d.group),
    host: stripHtml(d.host),
    status: num(d.status_raw, 1),
    tags: splitTags(d.tags),
    priority: num(d.priority_raw, num(d.priority, 3)),
  };
}

function mapSensor(s) {
  return {
    id: num(s.objid, 0),
    deviceId: num(s.parentid, 0),
    device: stripHtml(s.device),
    group: stripHtml(s.group),
    name: stripHtml(s.sensor),
    status: num(s.status_raw, 1),
    message: stripHtml(s.message_raw != null ? s.message_raw : s.message),
    lastValue: stripHtml(s.lastvalue),
    priority: num(s.priority_raw, num(s.priority, 3)),
    tags: splitTags(s.tags),
    downSince: stripHtml(s.downtimesince),
  };
}

// Cache + in-flight de-duplication: N screens => 1 PRTG query per CACHE_SECONDS.
let cache = null;
let cacheAt = 0;
let inflight = null;

function getState() {
  if (cache && Date.now() - cacheAt < cfg.cacheSeconds * 1000) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = Promise.all([prtgGet(DEVICES_QUERY), prtgGet(SENSORS_QUERY)])
    .then(([d, s]) => {
      cache = {
        ok: true,
        fetchedAt: new Date().toISOString(),
        prtgVersion: d['prtg-version'] || s['prtg-version'] || '',
        devices: (d.devices || []).map(mapDevice),
        sensors: (s.sensors || []).map(mapSensor),
      };
      cacheAt = Date.now();
      return cache;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
};

function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type }, SECURITY_HEADERS, extra || {}));
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), MIME['.json'], { 'Cache-Control': 'no-store' });
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function authorized(req) {
  if (!cfg.dashUser) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const okUser = safeEqual(decoded.slice(0, idx), cfg.dashUser);
  const okPass = safeEqual(decoded.slice(idx + 1), cfg.dashPass);
  return okUser && okPass;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    send(res, 200, data, type, { 'Cache-Control': 'no-cache' });
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return send(res, 400, 'Bad request', 'text/plain');
  }

  if (pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, prtgConfigured: prtgConfigured() });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' });
  }

  if (!authorized(req)) {
    return send(res, 401, 'Authentication required', 'text/plain', {
      'WWW-Authenticate': 'Basic realm="NOC Dashboard", charset="UTF-8"',
    });
  }

  if (pathname === '/api/state') {
    if (!prtgConfigured()) {
      return sendJson(res, 503, {
        ok: false,
        error: 'PRTG not configured: set PRTG_URL and PRTG_APITOKEN (or PRTG_USER + PRTG_PASSHASH) in .env',
      });
    }
    return getState()
      .then((state) => sendJson(res, 200, state))
      .catch((err) => {
        log('warn', err.message);
        sendJson(res, 502, { ok: false, error: err.message });
      });
  }

  return serveStatic(req, res, pathname);
});

server.listen(cfg.port, cfg.bind, () => {
  log('info', `NOC dashboard listening on http://${cfg.bind}:${cfg.port}`);
  if (!prtgConfigured()) {
    log('warn', 'PRTG not configured - only demo mode (/?demo=1) will show data');
  } else {
    log('info', `PRTG source: ${cfg.prtgUrl} (auth: ${cfg.apiToken ? 'API token' : 'username/passhash'})`);
    if (cfg.insecureTls) log('warn', 'PRTG_INSECURE_TLS=1 - certificate validation DISABLED');
  }
  if (!cfg.dashUser) log('warn', 'DASH_USER not set - dashboard has no login; restrict access by firewall');
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function log(level, msg) {
  console.log(`${new Date().toISOString()} [${level}] ${msg}`);
}

function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
