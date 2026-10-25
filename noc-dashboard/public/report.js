(function () {
  'use strict';

  /*
   * Monthly availability report for the items on the NOC dashboard.
   * Uses the same NOC_CONFIG (panels + PRTG credentials) as the dashboard and
   * PRTG's historic data API: one request per sensor, daily averages, reading
   * the "Downtime" and coverage values PRTG records for every sensor.
   */
  var CFG = Object.assign({
    title: 'NOC',
    panels: [],
    prtgBase: '',
    apiToken: '',
    username: '',
    passhash: '',
    slaTarget: 99.9,
    historyRetries: 3,
    historyRetryWaitSeconds: 20,
  }, window.NOC_CONFIG || {});

  // Site files register views (NOC, VoIP, ...). The report covers one view or all.
  var PRESETS = window.NOC_PRESETS || [];
  var OWN_PANELS = (CFG.panels || []).slice();
  function panelsFor(scope) {
    if (!PRESETS.length) return OWN_PANELS;
    var list = scope && scope !== 'all' ? PRESETS.filter(function (p) { return p.key === scope; }) : PRESETS;
    return list.reduce(function (a, p) {
      return a.concat((p.panels || []).map(function (x) {
        return Object.assign({}, x, { title: list.length > 1 ? (p.label || p.key) + ' · ' + x.title : x.title });
      }));
    }, []);
  }
  if (!CFG.brandName && PRESETS.length && (!window.NOC_CONFIG || !window.NOC_CONFIG.title || window.NOC_CONFIG.title === 'NOC Dashboard')) {
    CFG.title = (PRESETS[0].title || CFG.title).replace(/\s+(NOC|VoIP)$/i, '');
  }

  // Opened from the dashboard (iframe srcdoc): the dashboard injects window.NOC_EMBED.
  var EMBED = window.NOC_EMBED || {};
  var params = new URLSearchParams(location.search);
  var DEMO = params.has('demo') && !!window.NOC_REPORT_DEMO;
  var DAY = 86400;
  var lastResult = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ------------------------------------------------------------------ PRTG API
  function authQuery() {
    if (CFG.apiToken) return '&apitoken=' + encodeURIComponent(CFG.apiToken);
    if (CFG.username && CFG.passhash) {
      return '&username=' + encodeURIComponent(CFG.username) + '&passhash=' + encodeURIComponent(CFG.passhash);
    }
    return '';
  }

  var debugInfo = { attempts: [] }; // first few history requests + raw replies (?debug=1)

  // Plain-text request with the same auth/headers; used for history (JSON / XML / CSV).
  function apiText(path) {
    return fetch((CFG.prtgBase || '') + path + authQuery(), {
      cache: 'no-store', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('PRTG refused the request (HTTP ' + r.status + ') - check the API key in the file');
      return r.text().then(function (t) {
        if (debugInfo.attempts.length < 6) debugInfo.attempts.push({ path: path, status: r.status, raw: t });
        if (!r.ok) {
          var err = new Error('PRTG returned HTTP ' + r.status + ': ' + t.slice(0, 200));
          err.retryable = r.status === 429 || r.status >= 500 || /limit|too many|busy/i.test(t);
          throw err;
        }
        return t;
      });
    });
  }

  function api(path) {
    var headers = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
    return fetch((CFG.prtgBase || '') + path + authQuery(), {
      cache: 'no-store', credentials: 'same-origin', headers: headers,
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('PRTG refused the request (HTTP ' + r.status + ') - check the API key in the file');
      return r.text().then(function (t) {
        var j;
        try { j = JSON.parse(t); } catch (e) { j = null; }
        if (!r.ok || !j) {
          var err = new Error('PRTG returned HTTP ' + r.status + (j ? '' : ' (not JSON)') + ': ' + t.slice(0, 200));
          err.retryable = r.status === 429 || r.status >= 500 || /limit|too many|busy/i.test(t);
          throw err;
        }
        return j;
      });
    });
  }

  function prtgDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' +
      pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
  }

  var parser = new DOMParser();
  function strip(s) {
    var str = String(s == null ? '' : s);
    if (str.indexOf('<') < 0 && str.indexOf('&') < 0) return str.trim();
    return (parser.parseFromString(str, 'text/html').body.textContent || '').trim();
  }

  function loadInventory() {
    if (DEMO) return Promise.resolve(window.NOC_REPORT_DEMO.inventory());
    var tags = [];
    (CFG.panels || []).forEach(function (p) {
      (p.items || []).forEach(function (it) {
        if (it.tag && tags.indexOf(String(it.tag).toLowerCase()) < 0) tags.push(String(it.tag).toLowerCase());
      });
    });
    return Promise.all([
      api('/api/table.json?content=devices&output=json&count=50000&columns=objid,device,host'),
      api('/api/table.json?content=sensors&output=json&count=50000&columns=objid,parentid,device,sensor'),
      Promise.all(tags.map(function (t) {
        return api('/api/table.json?content=sensors&output=json&count=50000&columns=objid&filter_tags=' + encodeURIComponent('@tag(' + t + ')'))
          .then(function (r) { return [t, (r.sensors || []).map(function (x) { return Number(x.objid); })]; })
          .catch(function () { return [t, []]; });
      })),
    ]).then(function (r) {
      var tagIds = {};
      r[2].forEach(function (pair) { tagIds[pair[0]] = pair[1]; });
      return {
        tagIds: tagIds,
        devices: (r[0].devices || []).map(function (d) {
          return { id: Number(d.objid), name: strip(d.device), host: strip(d.host) };
        }),
        sensors: (r[1].sensors || []).map(function (s) {
          return { id: Number(s.objid), deviceId: Number(s.parentid), device: strip(s.device), name: strip(s.sensor) };
        }),
      };
    });
  }

  // ------------------------------------------------------------------ item -> sensor (same rules as the dashboard)
  function squash(x) { return String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase(); }
  function textMatcher(pattern, exact) {
    var p = String(pattern);
    if (p.length > 2 && p[0] === '/' && p[p.length - 1] === '/') {
      var re = new RegExp(p.slice(1, -1), 'i');
      return function (v) { return re.test(String(v)); };
    }
    var want = squash(p);
    return exact
      ? function (v) { return squash(v) === want; }
      : function (v) { return squash(v).indexOf(want) >= 0; };
  }

  // A device's availability is taken from its Ping sensor (or its first sensor).
  function deviceSensor(dev, inv) {
    var list = inv.sensors.filter(function (s) { return s.deviceId === dev.id; });
    return list.filter(function (s) { return /ping/i.test(s.name); })[0] || list[0] || null;
  }

  // expand: true -> every sensor of a matched device gets its own row
  function resolve(item, inv) {
    var hits = resolveBase(item, inv);
    if (!item.expand) return hits;
    var out = [];
    hits.forEach(function (h) {
      if (!h.isDevice) { out.push(h); return; }
      inv.sensors.filter(function (x) { return x.device === h.device && x.deviceId === (h.sensor && h.sensor.deviceId); })
        .forEach(function (x) { out.push({ item: item, device: x.device, sensor: x }); });
    });
    return out;
  }

  function resolveBase(item, inv) {
    if (item.tag) {
      var ids = (inv.tagIds || {})[String(item.tag).toLowerCase()] || [];
      return inv.sensors.filter(function (x) { return ids.indexOf(x.id) >= 0; })
        .map(function (x) { return { item: item, device: x.device, sensor: x }; });
    }
    var out = [];
    function addDevice(d) {
      out.push({ item: item, device: d.name, sensor: deviceSensor(d, inv), isDevice: true });
    }
    if (item.id != null) {
      var id = Number(item.id);
      var s = inv.sensors.filter(function (x) { return x.id === id; })[0];
      if (s) return [{ item: item, device: s.device, sensor: s }];
      var d = inv.devices.filter(function (x) { return x.id === id; })[0];
      if (d) addDevice(d);
      return out;
    }
    var dm = item.device ? textMatcher(item.device, false) : null;
    if (item.sensor) {
      var sm = textMatcher(item.sensor, true);
      return inv.sensors
        .filter(function (x) { return sm(x.name) && (!dm || dm(x.device)); })
        .map(function (x) { return { item: item, device: x.device, sensor: x }; });
    }
    if (dm) inv.devices.filter(function (x) { return dm(x.name); }).forEach(addDevice);
    return out;
  }

  // ------------------------------------------------------------------ historic data -> availability
  function parsePct(v) {
    if (v == null || v === '') return null;
    var n = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  // PRTG's history comes in three formats. Some PRTG versions put only ONE value
  // per row into JSON (no Downtime); XML and CSV carry every channel by name.
  // Try JSON -> XML -> CSV on the first sensor and stick with what works.
  var HIST_FORMAT = null;
  var FORMATS = ['json', 'xml', 'csv'];

  function histPath(fmt, id, start, end, bucket) {
    return '/api/historicdata.' + fmt + '?id=' + id + '&avg=' + bucket +
      '&sdate=' + prtgDate(start) + '&edate=' + prtgDate(end);
  }

  function withRetry(fn) {
    var attempt = 0;
    function go() {
      return fn().catch(function (err) {
        if (err.retryable && attempt < CFG.historyRetries) { // PRTG throttles history requests
          attempt += 1;
          setProgress('PRTG is throttling history requests - waiting ' + CFG.historyRetryWaitSeconds + 's (retry ' + attempt + ')…');
          return sleep(CFG.historyRetryWaitSeconds * 1000).then(go);
        }
        throw err;
      });
    }
    return go();
  }

  function isSummaryRow(label) { return /sum|average|total/i.test(String(label || '')); }
  function isDownName(name, id) { return /^downtime\b/i.test(String(name || '').trim()) || String(id) === '-4'; }
  function rawPct(v) { var n = parseFloat(v); return isFinite(n) ? (n > 100 ? n / 100 : n) : null; } // raw may be 0.01 % units

  // -> { rows: [{ cov, down }], info }  (down = null when the row has no Downtime value)
  var PARSERS = {
    json: function (text) {
      var j = JSON.parse(text);
      var rows = (j.histdata || []).filter(function (r) { return !isSummaryRow(r.datetime); });
      var downKey = null, chans = {};
      rows.forEach(function (r) {
        Object.keys(r).forEach(function (k) { if (!downKey && /^downtime(\s*\(%\))?$/i.test(k.trim())) downKey = k; });
        if (Array.isArray(r.value)) r.value.forEach(function (x) { if (x) chans[String(x.channel || x.name || x.channelid)] = true; });
      });
      return {
        rows: rows.map(function (r) {
          var down = null;
          if (downKey) {
            down = parsePct(r[downKey]);
            if (down == null) down = rawPct(r[downKey + '(RAW)']);
          } else if (Array.isArray(r.value)) {
            var e = r.value.filter(function (x) { return x && isDownName(x.channel || x.name, x.channelid); })[0];
            if (e) down = parsePct(e.text != null ? e.text : e.value);
            if (down == null && Array.isArray(r.value_raw)) {
              var er = r.value_raw.filter(function (x) { return x && isDownName(x.channel || x.name, x.channelid); })[0];
              if (er) down = rawPct(er.value != null ? er.value : er.text);
            }
          }
          var cov = parsePct(r.coverage);
          if (cov == null && r.coverage_raw != null) cov = Number(r.coverage_raw) / 100;
          return { cov: cov, down: down };
        }),
        info: 'JSON: ' + (Object.keys(chans).length ? 'channels ' + Object.keys(chans).join(', ')
          : 'one value per row, e.g. ' + JSON.stringify(rows[0] || {}).slice(0, 140)),
      };
    },
    xml: function (text) {
      var doc = new DOMParser().parseFromString(text, 'text/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('not valid XML');
      var chans = {};
      function textOf(el, tag) { var n = el.getElementsByTagName(tag)[0]; return n ? n.textContent : null; }
      var items = Array.prototype.slice.call(doc.getElementsByTagName('item'));
      return {
        rows: items.filter(function (it) { return !isSummaryRow(textOf(it, 'datetime')); }).map(function (it) {
          var down = null, downRaw = null;
          Array.prototype.forEach.call(it.children, function (c) {
            var tag = c.tagName.toLowerCase();
            if (tag !== 'value' && tag !== 'value_raw') return;
            var ch = c.getAttribute('channel') || '', cid = c.getAttribute('channelid');
            chans[ch || cid] = true;
            if (!isDownName(ch, cid)) return;
            if (tag === 'value') down = parsePct(c.textContent);
            else downRaw = rawPct(c.textContent);
          });
          var cov = parsePct(textOf(it, 'coverage'));
          if (cov == null && textOf(it, 'coverage_raw') != null) cov = Number(textOf(it, 'coverage_raw')) / 100;
          return { cov: cov, down: down != null ? down : downRaw };
        }),
        info: 'XML: channels ' + (Object.keys(chans).join(', ') || 'none'),
      };
    },
    csv: function (text) {
      var lines = parseCsv(text);
      var head = (lines[0] || []).map(function (h) { return h.trim(); });
      var di = head.findIndex(function (h) { return /^downtime$/i.test(h); });
      var dri = head.findIndex(function (h) { return /^downtime\s*\(raw\)$/i.test(h); });
      var ci = head.findIndex(function (h) { return /^coverage$/i.test(h); });
      var cri = head.findIndex(function (h) { return /^coverage\s*\(raw\)$/i.test(h); });
      return {
        rows: lines.slice(1).filter(function (l) { return l.length > 1 && !isSummaryRow(l[0]); }).map(function (l) {
          var down = di >= 0 ? parsePct(l[di]) : null;
          if (down == null && dri >= 0) down = rawPct(l[dri]);
          var cov = ci >= 0 ? parsePct(l[ci]) : null;
          if (cov == null && cri >= 0) cov = Number(l[cri]) / 100;
          return { cov: cov, down: down };
        }),
        info: 'CSV: columns ' + head.slice(0, 12).join(', '),
      };
    },
  };

  function parseCsv(text) {
    var out = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') out.push(row);
        row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); out.push(row); }
    return out;
  }

  function history(sensorId, start, end, bucket) {
    if (DEMO) return Promise.resolve(window.NOC_REPORT_DEMO.history(sensorId, start, end));
    var order = HIST_FORMAT ? [HIST_FORMAT] : FORMATS;
    var infos = [];
    var i = 0;
    function next() {
      if (i >= order.length) return Promise.resolve({ rows: [], noDowntime: true, info: infos.join(' | ') });
      var fmt = order[i++];
      return withRetry(function () { return apiText(histPath(fmt, sensorId, start, end, bucket)); })
        .then(function (text) {
          var parsed;
          try { parsed = PARSERS[fmt](text); } catch (e) { parsed = { rows: [], info: fmt.toUpperCase() + ': unreadable (' + e.message + ')' }; }
          if (parsed.rows.some(function (r) { return r.down != null; })) {
            HIST_FORMAT = fmt;
            parsed.format = fmt;
            return parsed;
          }
          infos.push(parsed.info);
          if (HIST_FORMAT) return { rows: parsed.rows, noDowntime: true, info: parsed.info };
          return next();
        }, function (err) {
          if (HIST_FORMAT) throw err;
          infos.push(fmt.toUpperCase() + ': ' + err.message.slice(0, 100));
          return next();
        });
    }
    return next();
  }

  function availability(h, bucket) {
    var SLOT = bucket || DAY;
    if (h.noDowntime) return { error: 'PRTG history has no Downtime values — ' + h.info };
    var rows = h.rows || [];
    if (!rows.length) return { error: 'no history for this period' };
    var monitored = 0, down = 0;
    rows.forEach(function (r) {
      var cov = r.cov == null || !isFinite(r.cov) ? 100 : r.cov;
      var dt = r.down == null ? 0 : r.down;
      var secs = SLOT * Math.min(Math.max(cov, 0), 100) / 100;
      monitored += secs;
      down += secs * Math.min(Math.max(dt, 0), 100) / 100;
    });
    var periodSecs = rows.length * SLOT;
    return {
      uptime: monitored > 0 ? 100 * (1 - down / monitored) : null,
      downSecs: down,
      coverage: periodSecs > 0 ? 100 * monitored / periodSecs : 0,
    };
  }

  // ------------------------------------------------------------------ formatting
  function fmtPct(v) {
    if (v == null) return 'n/a';
    if (v >= 99.995) return '100%';
    return (Math.floor(v * 1000) / 1000).toFixed(3) + '%';
  }
  function fmtDur(secs) {
    var m = Math.round(secs / 60);
    if (m === 0) return secs > 0 ? '< 1m' : '0m';
    var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + mm + 'm';
  }
  function grade(v, sla) {
    if (v == null) return 'na';
    if (v >= sla) return 'good';
    if (v >= Math.min(99, sla - 0.5)) return 'warn';
    return 'bad';
  }
  function setProgress(t) {
    $('progress').hidden = !t;
    $('progress').textContent = t || '';
  }
  function showError(t) {
    $('error').hidden = !t;
    $('error').textContent = t || '';
  }

  // ------------------------------------------------------------------ main
  function run(period, sla, scope) {
    var start = period.start, end = period.end, label = period.label;
    var now = new Date();
    var partial = end > now;
    if (partial) end = now;
    if (end <= start) return Promise.reject(new Error('That period has not started yet.'));
    // hourly buckets for short periods (weekly reports), daily for longer ones
    var bucket = (end - start) <= 8 * DAY * 1000 ? 3600 : DAY;

    var scopeLabel = scope && scope !== 'all' && PRESETS.length > 1
      ? ' · ' + ((PRESETS.filter(function (p) { return p.key === scope; })[0] || {}).label || scope) : '';
    $('period').textContent = label + (partial ? ' (to date)' : '') + scopeLabel + ' · SLA target ' + sla + '%';
    CFG.panels = panelsFor(scope);

    setProgress('Loading PRTG inventory…');
    return loadInventory().then(function (inv) {
      var jobs = [];
      var panels = (CFG.panels || []).map(function (p) {
        var rows = [];
        (p.items || []).forEach(function (item) {
          var hits = resolve(item, inv);
          if (!hits.length && !item.optional) rows.push({ item: item, missing: 'not found in PRTG' });
          hits.forEach(function (h) {
            var row = { item: item, device: h.device, sensor: h.sensor, isDevice: h.isDevice, multi: hits.length > 1 };
            if (!h.sensor) row.missing = 'device has no sensors';
            else jobs.push(row);
            rows.push(row);
          });
        });
        return { title: p.title, rows: rows };
      });

      // Sequential on purpose: PRTG limits how fast historic data can be requested.
      var i = 0;
      function next() {
        if (i >= jobs.length) return Promise.resolve();
        var row = jobs[i++];
        setProgress('Reading history ' + i + ' / ' + jobs.length + ': ' + (row.item.label || row.sensor.name) + '…');
        return history(row.sensor.id, start, end, bucket)
          .then(function (h) { row.result = availability(h, bucket); })
          .catch(function (e) { row.result = { error: e.message }; })
          .then(next);
      }
      return next().then(function () {
        setProgress('');
        return { panels: panels, label: label, partial: partial, start: start, end: end, sla: sla, bucket: bucket, scopeLabel: scopeLabel };
      });
    });
  }

  function render(res) {
    var all = [];
    res.panels.forEach(function (p) { p.rows.forEach(function (r) { all.push(r); }); });
    var measured = all.filter(function (r) { return r.result && r.result.uptime != null; });
    var below = measured.filter(function (r) { return r.result.uptime < res.sla; });
    var worst = measured.slice().sort(function (a, b) { return a.result.uptime - b.result.uptime; })[0];
    var avg = measured.length
      ? measured.reduce(function (s, r) { return s + r.result.uptime; }, 0) / measured.length : null;
    var totalDown = measured.reduce(function (s, r) { return s + r.result.downSecs; }, 0);
    var failed = all.length - measured.length;

    var k = $('kpis');
    k.textContent = '';
    function kpi(n, l, cls) {
      var d = el('div', 'kpi ' + (cls || ''));
      d.appendChild(el('div', 'n', n));
      d.appendChild(el('div', 'l', l));
      k.appendChild(d);
    }
    kpi(fmtPct(avg), 'Average availability', grade(avg, res.sla));
    kpi(String(below.length) + ' / ' + measured.length, 'Below SLA (' + res.sla + '%)', below.length ? 'bad' : 'good');
    kpi(fmtDur(totalDown), 'Total downtime (all items)');
    kpi(worst ? fmtPct(worst.result.uptime) : 'n/a', 'Lowest: ' + (worst ? (worst.item.label || worst.sensor.name) : '-'), worst ? grade(worst.result.uptime, res.sla) : '');
    if (failed) kpi(String(failed), 'Items without data', 'warn');
    k.hidden = false;

    // why are rows empty? group the per-row errors so the cause is visible at once
    var reasons = {};
    all.forEach(function (r) {
      var msg = r.missing || (r.result && r.result.error);
      if (msg && !(r.result && r.result.uptime != null)) reasons[msg] = (reasons[msg] || 0) + 1;
    });
    var rk = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; });
    showError(rk.length ? 'Items without data:\n' + rk.map(function (m) { return '• ' + reasons[m] + ' × ' + m; }).join('\n') : '');

    if (params.has('debug')) {
      var d = $('debug') || document.body.appendChild(el('pre', 'debug'));
      d.id = 'debug';
      d.textContent = 'DEBUG - first history requests (credentials hidden). Format in use: ' + (HIST_FORMAT || 'none worked') + '\n\n' +
        (debugInfo.attempts.length ? debugInfo.attempts.map(function (a) {
          return 'GET ' + a.path + '\nHTTP ' + a.status + '\n' + a.raw.slice(0, 1500);
        }).join('\n\n----------------\n\n') : '(no history request was made)');
    }

    var root = $('tables');
    root.textContent = '';
    res.panels.forEach(function (p) {
      var box = el('section', 'panel');
      box.appendChild(el('h2', null, p.title));
      var t = el('table');
      var hr = el('tr');
      [['Item'], ['Availability', 'num'], ['Downtime', 'num'], ['Monitored', 'num'], [''], ['Notes']].forEach(function (h) {
        hr.appendChild(el('th', h[1] || null, h[0]));
      });
      var thead = el('thead'); thead.appendChild(hr); t.appendChild(thead);
      var tb = el('tbody');
      p.rows.forEach(function (r) {
        var tr = el('tr');
        var name = el('td');
        name.appendChild(document.createTextNode(r.item.label && !r.multi ? r.item.label : (r.sensor ? r.sensor.name : (r.item.label || r.item.sensor || r.item.device || (r.item.tag ? 'Tag "' + r.item.tag + '"' : 'ID ' + r.item.id)))));
        if (r.sensor) name.appendChild(el('span', 'via', r.device + (r.isDevice ? ' · via ' + r.sensor.name : '') + ' · #' + r.sensor.id));
        tr.appendChild(name);

        var res1 = r.result || {};
        var g = grade(res1.uptime, res.sla);
        tr.appendChild(el('td', 'num up ' + g, fmtPct(res1.uptime)));
        tr.appendChild(el('td', 'num', res1.downSecs != null ? fmtDur(res1.downSecs) : '-'));
        tr.appendChild(el('td', 'num', res1.coverage != null ? Math.round(res1.coverage) + '%' : '-'));
        var barTd = el('td');
        if (res1.uptime != null) {
          var bar = el('div', 'bar ' + g);
          var fill = el('span');
          // scale 95-100% across the bar so small differences are visible
          fill.style.width = Math.max(2, Math.min(100, (res1.uptime - 95) * 20)) + '%';
          bar.appendChild(fill);
          barTd.appendChild(bar);
        }
        tr.appendChild(barTd);
        var note = r.missing || res1.error || (res1.coverage != null && res1.coverage < 95 ? 'monitored only ' + Math.round(res1.coverage) + '% of the period' : '');
        tr.appendChild(el('td', 'note', note));
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      box.appendChild(t);
      root.appendChild(box);
    });

    var foot = $('foot');
    foot.hidden = false;
    foot.textContent = 'Source: PRTG historic data (' + (res.bucket === 3600 ? 'hourly' : 'daily') + ' averages' + (HIST_FORMAT ? ', ' + HIST_FORMAT.toUpperCase() : '') + '), ' + res.start.toLocaleString() + ' – ' + res.end.toLocaleString() +
      '. Availability = 100% − PRTG "Downtime", over the time each sensor was actually monitored (paused time excluded). ' +
      'Devices are measured by their Ping sensor. Generated ' + new Date().toLocaleString() + (DEMO ? ' · DEMO DATA' : '') + '.' +
      (window.NOC_BUILD ? ' Report build ' + window.NOC_BUILD + '.' : '');

    document.title = (CFG.brandName || CFG.title) + ' – Availability ' + res.label + res.scopeLabel;
    $('csv').disabled = false;
    $('print').disabled = false;
  }

  function toCsv(res) {
    var lines = [['Panel', 'Item', 'Device', 'Sensor ID', 'Availability %', 'Downtime minutes', 'Monitored %', 'Notes']];
    res.panels.forEach(function (p) {
      p.rows.forEach(function (r) {
        var x = r.result || {};
        lines.push([
          p.title,
          r.item.label || (r.sensor && r.sensor.name) || '',
          r.device || '',
          r.sensor ? r.sensor.id : '',
          x.uptime != null ? x.uptime.toFixed(4) : '',
          x.downSecs != null ? (x.downSecs / 60).toFixed(1) : '',
          x.coverage != null ? x.coverage.toFixed(1) : '',
          r.missing || x.error || '',
        ]);
      });
    });
    return lines.map(function (l) {
      return l.map(function (v) {
        var s = String(v);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // no formula injection when opened in Excel
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  // ------------------------------------------------------------------ periods
  var WEEK_START = CFG.weekStartsOn != null ? Number(CFG.weekStartsOn) : 0; // 0 = Sunday
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function weekStart(d) { var x = day0(d); return addDays(x, -((x.getDay() - WEEK_START + 7) % 7)); }
  function fmtD(d, withYear) {
    return d.toLocaleDateString([], withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
  }
  function rangeLabel(a, b) { // b exclusive
    var last = addDays(b, -1);
    return fmtD(a, a.getFullYear() !== last.getFullYear()) + ' – ' + fmtD(last, true);
  }
  function monthPeriod(y, m) {
    var a = new Date(y, m, 1), b = new Date(y, m + 1, 1);
    return { start: a, end: b, label: a.toLocaleDateString([], { month: 'long', year: 'numeric' }), slug: y + '-' + pad(m + 1) };
  }
  function getPeriod() {
    var today = day0(new Date()), r = $('range').value, a, b;
    if (r === 'last-month') return monthPeriod(today.getFullYear(), today.getMonth() - 1);
    if (r === 'this-month') return monthPeriod(today.getFullYear(), today.getMonth());
    if (r === 'month') {
      var v = $('month').value;
      if (!v) throw new Error('Pick a month.');
      return monthPeriod(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1);
    }
    if (r === 'last-week') { b = weekStart(today); a = addDays(b, -7); }
    else if (r === 'this-week') { a = weekStart(today); b = addDays(a, 7); }
    else if (r === 'last-7') { b = today; a = addDays(b, -7); }
    else {
      if (!$('from').value || !$('to').value) throw new Error('Pick both dates.');
      var f = $('from').value.split('-').map(Number), t = $('to').value.split('-').map(Number);
      a = new Date(f[0], f[1] - 1, f[2]); b = addDays(new Date(t[0], t[1] - 1, t[2]), 1);
      if (b <= a) throw new Error('"To" must be on or after "From".');
    }
    var lbl = (r === 'last-week' || r === 'this-week' ? 'Week ' : '') + rangeLabel(a, b);
    return { start: a, end: b, label: lbl, slug: a.getFullYear() + '-' + pad(a.getMonth() + 1) + '-' + pad(a.getDate()) + '_' + Math.round((b - a) / 864e5) + 'd' };
  }
  function syncRangeInputs() {
    var r = $('range').value;
    $('month-wrap').hidden = r !== 'month';
    $('from-wrap').hidden = r !== 'custom';
    $('to-wrap').hidden = r !== 'custom';
  }

  // ------------------------------------------------------------------ wire up
  if (CFG.theme) document.body.classList.add('theme-' + CFG.theme);
  if (EMBED.embedded) document.body.classList.add('embedded');
  (function () {
    var box = $('logo');
    if (!box) return;
    function wordmark() {
      box.textContent = '';
      if (!CFG.wordmark) { box.hidden = true; return; }
      var w = el('span', 'wm');
      w.appendChild(el('span', 'wm-a', CFG.wordmark[0] || ''));
      w.appendChild(el('span', 'wm-b', CFG.wordmark[1] || ''));
      box.appendChild(w);
      box.hidden = false;
    }
    if (CFG.logo) {
      var img = document.createElement('img');
      img.alt = CFG.brandName || 'logo';
      img.onerror = wordmark;
      img.onload = function () { box.hidden = false; };
      img.src = CFG.logo;
      box.appendChild(img);
    } else wordmark();
  })();

  var prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
  $('month').value = params.get('month') || (prev.getFullYear() + '-' + pad(prev.getMonth() + 1));
  $('range').value = params.get('month') ? 'month' : (params.get('range') || EMBED.range || 'last-month');
  $('sla').value = params.get('sla') || CFG.slaTarget;
  $('title').textContent = (CFG.brandName || CFG.title.replace(/\s*NOC$/i, '')) + ' – Availability Report';
  if (window.NOC_BUILD) $('period').textContent += ' · build ' + window.NOC_BUILD;
  $('range').addEventListener('change', syncRangeInputs);
  syncRangeInputs();

  var scopeSel = $('scope');
  if (PRESETS.length > 1) {
    scopeSel.appendChild(new Option('All views', 'all'));
    PRESETS.forEach(function (p) { scopeSel.appendChild(new Option(p.label || p.key, p.key)); });
    scopeSel.value = params.get('view') || EMBED.view || 'all';
  } else {
    $('scope-wrap').hidden = true;
  }

  $('controls').addEventListener('submit', function (e) {
    e.preventDefault();
    showError('');
    var period;
    try { period = getPeriod(); } catch (err) { showError(err.message); return; }
    $('go').disabled = true;
    var sla = parseFloat($('sla').value) || CFG.slaTarget;
    run(period, sla, scopeSel.value || 'all')
      .then(function (res) { res.slug = period.slug; lastResult = res; render(res); })
      .catch(function (err) { setProgress(''); showError(err.message || String(err)); })
      .then(function () { $('go').disabled = false; });
  });

  $('csv').addEventListener('click', function () {
    if (!lastResult) return;
    var blob = new Blob(['\ufeff' + toCsv(lastResult)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'availability-' + (lastResult.slug || 'report') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  $('print').addEventListener('click', function () { window.print(); });

  if (params.has('auto') || DEMO) $('controls').requestSubmit();
  if (params.has('demo') && !DEMO) showError('Demo data is not bundled in this build.');
})();
