(function () {
  'use strict';

  /*
   * Sensor audit: which PRTG sensors can go (to free licence slots) and where
   * monitoring is thin. Read-only - it never changes anything in PRTG.
   */
  var CFG = Object.assign({
    title: 'NOC', panels: [], prtgBase: '', apiToken: '', username: '', passhash: '',
    licenceLimit: 100, longDownDays: 7,
  }, window.NOC_CONFIG || {});

  // Site files register views (NOC, VoIP, ...); cover the items of all of them.
  var PRESETS = window.NOC_PRESETS || [];
  if (PRESETS.length && !(CFG.panels || []).length) {
    CFG.panels = PRESETS.reduce(function (a, p) {
      return a.concat((p.panels || []).map(function (x) {
        return Object.assign({}, x, { title: PRESETS.length > 1 ? (p.label || p.key) + ' · ' + x.title : x.title });
      }));
    }, []);
    if (!window.NOC_CONFIG || !window.NOC_CONFIG.title || window.NOC_CONFIG.title === 'NOC Dashboard') {
      CFG.title = (PRESETS[0].title || CFG.title).replace(/\s+(NOC|VoIP)$/i, '');
    }
  }
  var params = new URLSearchParams(location.search);
  var last = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function authQuery() {
    if (CFG.apiToken) return '&apitoken=' + encodeURIComponent(CFG.apiToken);
    if (CFG.username && CFG.passhash) {
      return '&username=' + encodeURIComponent(CFG.username) + '&passhash=' + encodeURIComponent(CFG.passhash);
    }
    return '';
  }
  function api(path) {
    return fetch((CFG.prtgBase || '') + path + authQuery(), {
      cache: 'no-store', credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('PRTG refused the request (HTTP ' + r.status + ') - check the API key in the file');
      if (!r.ok) throw new Error('PRTG returned HTTP ' + r.status);
      return r.json();
    });
  }
  var parser = new DOMParser();
  function strip(s) {
    var str = String(s == null ? '' : s);
    if (str.indexOf('<') < 0 && str.indexOf('&') < 0) return str.trim();
    return (parser.parseFromString(str, 'text/html').body.textContent || '').trim();
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }

  var PAUSED = { 7: 'Paused by user', 8: 'Paused by dependency', 9: 'Paused by schedule', 12: 'Paused until' };
  var DOWN = { 5: 'Down', 13: 'Down (ack)', 14: 'Partial down' };
  var SYSTEM = /^(core health|probe health|system health|core health \(autonomous\)|cluster health)/i;

  function load() {
    return Promise.all([
      api('/api/table.json?content=sensors&output=json&count=50000' +
        '&columns=objid,parentid,probe,group,device,sensor,type,status,message,lastvalue,interval,downtimesince,tags'),
      api('/api/table.json?content=devices&output=json&count=50000&columns=objid,group,device,host,status,totalsens'),
    ]).then(function (r) {
      return {
        sensors: (r[0].sensors || []).map(function (s) {
          return {
            id: num(s.objid), deviceId: num(s.parentid), group: strip(s.group), device: strip(s.device),
            name: strip(s.sensor), type: strip(s.type), status: num(s.status_raw), statusText: strip(s.status),
            message: strip(s.message_raw != null ? s.message_raw : s.message), lastValue: strip(s.lastvalue),
            lastRaw: num(s.lastvalue_raw), interval: strip(s.interval),
            downSecs: num(s.downtimesince_raw), downText: strip(s.downtimesince),
          };
        }),
        devices: (r[1].devices || []).map(function (d) {
          return { id: num(d.objid), group: strip(d.group), name: strip(d.device), host: strip(d.host) };
        }),
      };
    });
  }

  // IDs the dashboard shows (by ID; name-matched items are approximated by name)
  function dashboardIds(inv) {
    var ids = {};
    (CFG.panels || []).forEach(function (p) {
      (p.items || []).forEach(function (it) {
        if (it.id != null) ids[Number(it.id)] = true;
      });
    });
    return ids;
  }

  function analyse(inv, limit, days) {
    var onDash = dashboardIds(inv);
    var byDevice = {};
    inv.sensors.forEach(function (s) { (byDevice[s.deviceId] = byDevice[s.deviceId] || []).push(s); });

    var del = [], fix = [], add = [];

    inv.sensors.forEach(function (s) {
      if (PAUSED[s.status]) {
        del.push({ s: s, why: PAUSED[s.status] + ' - still uses a licence slot', sev: 1 });
      } else if (DOWN[s.status] && s.downSecs != null && s.downSecs > days * 86400) {
        del.push({ s: s, why: DOWN[s.status] + ' for ' + (s.downText || Math.round(s.downSecs / 86400) + ' d') + ' - fix it or delete it', sev: 2 });
      } else if (DOWN[s.status] || s.status === 4 || s.status === 10) {
        fix.push({ s: s, why: s.statusText + (s.message ? ': ' + s.message : '') });
      }
    });

    // duplicates: same device + same type + same name, or 2+ Ping sensors on one device
    Object.keys(byDevice).forEach(function (dev) {
      var seen = {};
      var pings = [];
      byDevice[dev].forEach(function (s) {
        var key = s.type.toLowerCase() + '|' + s.name.replace(/\s+/g, '').toLowerCase();
        if (seen[key]) del.push({ s: s, why: 'Duplicate of #' + seen[key].id + ' (same type and name on this device)', sev: 3 });
        else seen[key] = s;
        if (/ping/i.test(s.type) || /^ping\b/i.test(s.name)) pings.push(s);
      });
      if (pings.length > 1) {
        pings.slice(1).forEach(function (s) {
          if (!del.some(function (d) { return d.s === s; })) {
            del.push({ s: s, why: 'Second Ping sensor on this device (#' + pings[0].id + ' already pings it)', sev: 3 });
          }
        });
      }
    });

    // traffic sensors idle right now and not on the dashboard: candidates to review
    inv.sensors.forEach(function (s) {
      if (/traffic/i.test(s.type + ' ' + s.name) && s.lastRaw === 0 && !onDash[s.id] && !PAUSED[s.status] &&
          !del.some(function (d) { return d.s === s; })) {
        del.push({ s: s, why: 'Traffic sensor reading 0 right now - check the interface is still in use', sev: 4 });
      }
    });

    // gaps on dashboard devices: only one sensor (usually just Ping)
    inv.devices.forEach(function (d) {
      var list = byDevice[d.id] || [];
      var dashDevice = onDash[d.id] || list.some(function (s) { return onDash[s.id]; });
      var isFw = /forti|fgt|firewall/i.test(d.name + ' ' + d.group);
      if (dashDevice && list.length <= 1) {
        add.push({ d: d, why: 'On the dashboard with only ' + list.length + ' sensor' + (list.length === 1 ? ' (' + list[0].name + ')' : '') +
          ' - it shows the box answers ping, not that the service works', idea: suggestFor(d) });
      }
      if (isFw && !list.some(function (s) { return /cpu|memory|ha\b|cluster|session/i.test(s.name); })) {
        add.push({ d: d, why: 'FortiGate with no CPU / memory / HA / session sensor', idea: 'SNMP Fortinet FortiGate sensor (CPU, memory, sessions in one sensor) - check your PRTG version lists it' });
      }
    });

    del.sort(function (a, b) { return a.sev - b.sev || a.s.device.localeCompare(b.s.device); });

    var counted = inv.sensors.length;
    return { del: del, fix: fix, add: add, total: counted, limit: limit, onDashCount: Object.keys(onDash).length };
  }

  function suggestFor(d) {
    var n = d.name.toLowerCase();
    if (/ad0|dns|ads|domain|dc/.test(n)) return 'DNS v2 sensor (resolves a name) or an Active Directory replication sensor';
    if (/freeswitch|sip|voip|pbx/.test(n)) return 'SIP Options sensor (checks the SIP service answers)';
    if (/switch|core|sw/.test(n)) return 'SNMP CPU Load or the uplink SNMP Traffic sensor';
    if (/genesys|cloud|http|web/.test(n)) return 'HTTP sensor on the service URL';
    if (/fsso|collector/.test(n)) return 'Port sensor on the FSSO collector port (8000 by default)';
    return 'a service check (Port / HTTP) for what this device actually does';
  }

  // ------------------------------------------------------------------ render
  function table(title, cols, rows, empty) {
    var box = el('section', 'panel');
    box.appendChild(el('h2', null, title + ' (' + rows.length + ')'));
    if (!rows.length) {
      var p = el('p', 'note', empty);
      p.style.padding = '.6rem 1rem';
      box.appendChild(p);
      return box;
    }
    var t = el('table', 'audit');
    var hr = el('tr');
    cols.forEach(function (c) { hr.appendChild(el('th', null, c[0])); });
    var th = el('thead'); th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      cols.forEach(function (c) { tr.appendChild(el('td', c[2] || null, c[1](r))); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    box.appendChild(t);
    return box;
  }

  function render(a) {
    var k = $('kpis');
    k.textContent = '';
    function kpi(n, l, cls) {
      var d = el('div', 'kpi ' + (cls || ''));
      d.appendChild(el('div', 'n', n));
      d.appendChild(el('div', 'l', l));
      k.appendChild(d);
    }
    var free = a.limit - a.total;
    var freeable = a.del.filter(function (d) { return d.sev <= 3; }).length;
    kpi(a.total + ' / ' + a.limit, 'Sensors used / licence', free <= 5 ? 'bad' : free <= 15 ? 'warn' : 'good');
    kpi(String(free), 'Free slots now', free <= 5 ? 'bad' : 'good');
    kpi(String(freeable), 'Could be freed (paused, long down, duplicate)', freeable ? 'good' : '');
    kpi(String(a.fix.length), 'Currently in alarm', a.fix.length ? 'warn' : 'good');
    kpi(String(a.add.length), 'Monitoring gaps found', a.add.length ? 'warn' : 'good');
    k.hidden = false;

    var sensorCols = [
      ['Sensor', function (r) { return r.s.name + '  (#' + r.s.id + ')'; }],
      ['Device', function (r) { return r.s.device; }],
      ['Type', function (r) { return r.s.type; }],
      ['Why', function (r) { return r.why; }, 'note'],
    ];
    var root = $('tables');
    root.textContent = '';
    root.appendChild(table('Candidates to delete or fix', sensorCols, a.del,
      'Nothing paused, long-down or duplicated.'));
    root.appendChild(table('Currently in alarm (fix, don\'t delete)', sensorCols, a.fix, 'No sensors in alarm.'));
    root.appendChild(table('Monitoring gaps (consider adding)', [
      ['Device', function (r) { return r.d.name; }],
      ['Group', function (r) { return r.d.group; }],
      ['Gap', function (r) { return r.why; }, 'note'],
      ['Suggested sensor', function (r) { return r.idea; }, 'note'],
    ], a.add, 'No obvious gaps on dashboard devices.'));

    var foot = $('foot');
    foot.hidden = false;
    foot.textContent = 'Read-only audit - nothing was changed in PRTG. Paused sensors still count against the licence. ' +
      '"Idle traffic" rows only reflect the value right now; check the 30-day graph before deleting. ' +
      'Generated ' + new Date().toLocaleString() + '.';
    $('csv').disabled = false;
    $('print').disabled = false;
  }

  function toCsv(a) {
    var lines = [['Section', 'Sensor ID', 'Sensor', 'Device', 'Type', 'Reason / gap', 'Suggestion']];
    a.del.forEach(function (r) { lines.push(['Delete/fix', r.s.id, r.s.name, r.s.device, r.s.type, r.why, '']); });
    a.fix.forEach(function (r) { lines.push(['In alarm', r.s.id, r.s.name, r.s.device, r.s.type, r.why, '']); });
    a.add.forEach(function (r) { lines.push(['Gap', '', '', r.d.name, '', r.why, r.idea]); });
    return lines.map(function (l) {
      return l.map(function (v) {
        var s = String(v == null ? '' : v);
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  if (CFG.theme) document.body.classList.add('theme-' + CFG.theme);
  $('limit').value = params.get('limit') || CFG.licenceLimit;
  $('days').value = params.get('days') || CFG.longDownDays;
  $('title').textContent = (CFG.brandName || CFG.title.replace(/\s*NOC$/i, '')) + ' – Sensor Audit';

  $('controls').addEventListener('submit', function (e) {
    e.preventDefault();
    $('error').hidden = true;
    $('progress').hidden = false;
    $('progress').textContent = 'Reading all sensors from PRTG…';
    $('go').disabled = true;
    load()
      .then(function (inv) {
        last = analyse(inv, Number($('limit').value) || 100, Number($('days').value) || 7);
        render(last);
      })
      .catch(function (err) { $('error').hidden = false; $('error').textContent = err.message; })
      .then(function () { $('progress').hidden = true; $('go').disabled = false; });
  });
  $('csv').addEventListener('click', function () {
    if (!last) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + toCsv(last)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'sensor-audit.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $('print').addEventListener('click', function () { window.print(); });

  if (params.has('auto')) $('controls').requestSubmit();
})();
