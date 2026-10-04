(function () {
  'use strict';

  var CFG = Object.assign({
    title: 'NOC Dashboard',
    subtitle: 'PRTG live status',
    refreshSeconds: 30,
    staleAfterSeconds: 120,
    sections: [],
    unmatched: 'group',
    excludeGroups: [],
    hidePausedDevices: false,
    sortDevices: 'name',
    showHost: true,
    maxProblemsPerTile: 3,
    maxAlerts: 50,
    alertStatuses: ['down', 'warn', 'unusual', 'ack'],
    source: 'backend', // 'backend' = Node server (/api/state); 'prtg' = call PRTG API directly
    prtgBase: '',      // direct mode: '' = same origin as the page (file inside PRTG webroot)
    apiToken: '',      // direct mode: PRTG API key (read-only user). Empty = use logged-in session
    username: '',      // direct mode alternative to apiToken: PRTG username ...
    passhash: '',      // ... + that user's passhash
  }, window.NOC_CONFIG || {});

  var params = new URLSearchParams(location.search);
  var DEMO = params.has('demo');
  if (params.has('kiosk')) document.body.classList.add('kiosk');

  // PRTG status_raw -> [css class, label]
  var STATUS = {
    1: ['unknown', 'Unknown'],
    2: ['unknown', 'Scanning'],
    3: ['up', 'Up'],
    4: ['warn', 'Warning'],
    5: ['down', 'Down'],
    6: ['unknown', 'No Probe'],
    7: ['paused', 'Paused'],
    8: ['paused', 'Paused (dependency)'],
    9: ['paused', 'Paused (schedule)'],
    10: ['unusual', 'Unusual'],
    11: ['unknown', 'Not Licensed'],
    12: ['paused', 'Paused (until)'],
    13: ['ack', 'Down (Ack)'],
    14: ['down', 'Partial Down'],
  };
  var RANK = { down: 0, warn: 1, unusual: 2, ack: 3, unknown: 4, paused: 5, up: 6 };

  var SUMMARY = [
    ['down', 'Down'],
    ['warn', 'Warning'],
    ['unusual', 'Unusual'],
    ['ack', 'Ack'],
    ['paused', 'Paused'],
    ['up', 'Up'],
  ];

  function cls(code) { return (STATUS[code] || STATUS[1])[0]; }
  function label(code) { return (STATUS[code] || STATUS[1])[1]; }

  var compiled = (CFG.sections || []).map(function (s) {
    return {
      title: s.title,
      tags: (s.tags || []).map(function (t) { return String(t).toLowerCase(); }),
      groups: (s.groups || []).map(function (g) { return new RegExp(g, 'i'); }),
      devices: (s.devices || []).map(function (d) { return new RegExp(d, 'i'); }),
    };
  });
  var excluded = (CFG.excludeGroups || []).map(function (g) { return new RegExp(g, 'i'); });

  var state = {
    data: null,
    lastOkAt: 0,
    lastError: '',
    knownAlerts: null, // Set of alert sensor ids from previous render
  };

  // ------------------------------------------------------------------ DOM utils
  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  // ------------------------------------------------------------------ data
  // ---- direct PRTG mode (single-file install inside PRTG's webroot) --------
  // Same-origin calls to /api/table.json ride on the viewer's PRTG login
  // session, so no credentials need to live in the page.
  var DEVICE_COLS = 'objid,group,device,host,status,tags,priority';
  var SENSOR_COLS = 'objid,parentid,group,device,sensor,status,message,lastvalue,priority,tags,downtimesince';

  function prtgTable(content, columns, signal) {
    var url = (CFG.prtgBase || '') + '/api/table.json?content=' + content +
      '&output=json&count=50000&columns=' + columns;
    if (CFG.apiToken) {
      url += '&apitoken=' + encodeURIComponent(CFG.apiToken);
    } else if (CFG.username && CFG.passhash) {
      url += '&username=' + encodeURIComponent(CFG.username) + '&passhash=' + encodeURIComponent(CFG.passhash);
    }
    // Send the same request headers PRTG's own web UI (jQuery) sends.
    var headers = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
    var csrf = document.querySelector('meta[name="csrf-token"]');
    if (csrf && csrf.content) headers['X-CSRF-Token'] = csrf.content;
    return fetch(url, { cache: 'no-store', credentials: 'same-origin', headers: headers, signal: signal })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('PRTG refused the request (HTTP ' + r.status + ') - ' + (CFG.apiToken || CFG.passhash ? 'PRTG rejected the key/passhash in the file - check it was pasted correctly' : 'log in to PRTG on this exact address, or set apiToken'));
        if (!r.ok) throw new Error('PRTG returned HTTP ' + r.status);
        return r.json().catch(function () {
          throw new Error('PRTG session expired or returned a login page - log in and reload');
        });
      });
  }

  // DOMParser builds an inert document (no script execution, no image loads)
  var parser = new DOMParser();
  function strip(s) {
    var str = String(s == null ? '' : s);
    if (str.indexOf('<') < 0 && str.indexOf('&') < 0) return str.trim();
    return (parser.parseFromString(str, 'text/html').body.textContent || '').trim();
  }
  function n(v, f) { var x = Number(v); return isFinite(x) ? x : f; }
  function tagList(t) { return String(t || '').split(/[\s,]+/).filter(Boolean); }

  function fetchDirect(signal) {
    return Promise.all([
      prtgTable('devices', DEVICE_COLS, signal),
      prtgTable('sensors', SENSOR_COLS, signal),
    ]).then(function (res) {
      return {
        ok: true,
        devices: (res[0].devices || []).map(function (d) {
          return {
            id: n(d.objid, 0), name: strip(d.device), group: strip(d.group), host: strip(d.host),
            status: n(d.status_raw, 1), tags: tagList(d.tags), priority: n(d.priority_raw, n(d.priority, 3)),
          };
        }),
        sensors: (res[1].sensors || []).map(function (s) {
          return {
            id: n(s.objid, 0), deviceId: n(s.parentid, 0), device: strip(s.device), group: strip(s.group),
            name: strip(s.sensor), status: n(s.status_raw, 1),
            message: strip(s.message_raw != null ? s.message_raw : s.message),
            lastValue: strip(s.lastvalue), priority: n(s.priority_raw, n(s.priority, 3)),
            tags: tagList(s.tags), downSince: strip(s.downtimesince),
          };
        }),
      };
    });
  }

  function fetchState() {
    if (DEMO) return Promise.resolve(window.NOC_DEMO());

    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 25000);

    if (CFG.source === 'prtg') {
      return fetchDirect(ctrl.signal).finally(function () { clearTimeout(t); });
    }

    return fetch('api/state', { cache: 'no-store', signal: ctrl.signal })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
      })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'Backend error');
        return j;
      })
      .finally(function () { clearTimeout(t); });
  }

  function sectionFor(dev) {
    var tags = dev.tags.map(function (t) { return t.toLowerCase(); });
    for (var i = 0; i < compiled.length; i++) {
      var s = compiled[i];
      if (s.tags.some(function (t) { return tags.indexOf(t) >= 0; })) return s.title;
      if (s.groups.some(function (re) { return re.test(dev.group); })) return s.title;
      if (s.devices.some(function (re) { return re.test(dev.name); })) return s.title;
    }
    return CFG.unmatched === 'group' ? (dev.group || 'Ungrouped') : 'Other';
  }

  function model(data) {
    var sensorsByDevice = {};
    var totals = { down: 0, warn: 0, unusual: 0, ack: 0, paused: 0, up: 0, unknown: 0, all: 0 };

    var devices = data.devices.filter(function (d) {
      return !excluded.some(function (re) { return re.test(d.group); });
    });
    var deviceIds = {};
    devices.forEach(function (d) { deviceIds[d.id] = true; });

    var sensors = data.sensors.filter(function (s) { return deviceIds[s.deviceId]; });
    sensors.forEach(function (s) {
      var c = cls(s.status);
      totals[c] += 1;
      totals.all += 1;
      (sensorsByDevice[s.deviceId] = sensorsByDevice[s.deviceId] || []).push(s);
    });

    var sections = {};
    devices.forEach(function (d) {
      d.sensors = (sensorsByDevice[d.id] || []).slice().sort(bySeverity);
      d.counts = {};
      d.sensors.forEach(function (s) { var c = cls(s.status); d.counts[c] = (d.counts[c] || 0) + 1; });
      if (CFG.hidePausedDevices && cls(d.status) === 'paused') return;
      var title = sectionFor(d);
      (sections[title] = sections[title] || []).push(d);
    });

    var order = compiled.map(function (s) { return s.title; });
    var titles = Object.keys(sections).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0) ia = 1e6;
      if (ib < 0) ib = 1e6;
      return ia - ib || a.localeCompare(b);
    });

    var alerts = sensors
      .filter(function (s) { return CFG.alertStatuses.indexOf(cls(s.status)) >= 0; })
      .sort(bySeverity);

    return {
      totals: totals,
      sections: titles.map(function (t) {
        var list = sections[t].slice().sort(CFG.sortDevices === 'severity' ? devBySeverity : byName);
        var worst = list.reduce(function (w, d) { return Math.min(w, RANK[cls(d.status)]); }, 6);
        return { title: t, devices: list, worst: worst };
      }),
      alerts: alerts,
      deviceCount: devices.length,
    };
  }

  function bySeverity(a, b) {
    return RANK[cls(a.status)] - RANK[cls(b.status)] ||
      (b.priority || 0) - (a.priority || 0) ||
      String(a.device).localeCompare(String(b.device)) ||
      String(a.name).localeCompare(String(b.name));
  }
  function devBySeverity(a, b) {
    return RANK[cls(a.status)] - RANK[cls(b.status)] || byName(a, b);
  }
  function byName(a, b) {
    return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
  }

  // ------------------------------------------------------------------ render
  function renderSummary(m) {
    var box = $('summary');
    box.textContent = '';
    SUMMARY.forEach(function (p) {
      var n = m.totals[p[0]] || 0;
      var pill = el('div', 'pill s-' + p[0] + (n === 0 && p[0] !== 'up' ? ' zero' : ''));
      pill.appendChild(el('span', 'n', String(n)));
      pill.appendChild(el('span', 'l', p[1]));
      box.appendChild(pill);
    });
    var tot = el('div', 'pill total');
    tot.appendChild(el('span', 'n', String(m.totals.all)));
    tot.appendChild(el('span', 'l', 'Sensors / ' + m.deviceCount + ' dev'));
    box.appendChild(tot);
  }

  function renderSections(m) {
    var root = $('sections');
    var frag = document.createDocumentFragment();

    if (!m.sections.length) {
      frag.appendChild(el('div', 'empty', 'No devices returned by PRTG. Check the API user\'s read access.'));
    }

    m.sections.forEach(function (sec) {
      var worstCls = Object.keys(RANK).filter(function (k) { return RANK[k] === sec.worst; })[0];
      var wrap = el('div', 'section s-' + worstCls);
      var head = el('div', 'section-head');
      head.appendChild(el('h2', null, sec.title));
      head.appendChild(el('span', 'meta', sec.devices.length + (sec.devices.length === 1 ? ' device' : ' devices')));
      wrap.appendChild(head);

      var grid = el('div', 'tiles');
      sec.devices.forEach(function (d) { grid.appendChild(renderTile(d)); });
      wrap.appendChild(grid);
      frag.appendChild(wrap);
    });

    root.textContent = '';
    root.appendChild(frag);
  }

  function renderTile(d) {
    var c = cls(d.status);
    var tile = el('div', 'tile s-' + c);
    tile.title = d.name + ' - ' + label(d.status) + (d.group ? ' (' + d.group + ')' : '');

    var top = el('div', 'tile-top');
    top.appendChild(el('span', 'dot'));
    top.appendChild(el('span', 'name', d.name));
    tile.appendChild(top);

    var sub = el('div', 'sub');
    if (CFG.showHost && d.host) sub.appendChild(el('span', 'host', d.host));
    sub.appendChild(el('span', 'state', label(d.status)));
    tile.appendChild(sub);

    var counts = el('div', 'counts');
    ['down', 'warn', 'unusual', 'ack', 'paused', 'up'].forEach(function (k) {
      if (!d.counts[k]) return;
      counts.appendChild(el('span', 'c s-' + k, String(d.counts[k])));
    });
    if (!d.sensors.length) counts.appendChild(el('span', 'c none', 'no sensors'));
    tile.appendChild(counts);

    var problems = d.sensors.filter(function (s) {
      var k = cls(s.status);
      return k !== 'up' && k !== 'paused';
    });
    if (problems.length && CFG.maxProblemsPerTile > 0) {
      var ul = el('ul', 'problems');
      problems.slice(0, CFG.maxProblemsPerTile).forEach(function (s) {
        var li = el('li', 's-' + cls(s.status));
        li.appendChild(el('span', 'pn', s.name));
        if (s.lastValue) li.appendChild(el('span', 'pv', s.lastValue));
        ul.appendChild(li);
      });
      if (problems.length > CFG.maxProblemsPerTile) {
        ul.appendChild(el('li', 'more', '+' + (problems.length - CFG.maxProblemsPerTile) + ' more'));
      }
      tile.appendChild(ul);
    }
    return tile;
  }

  function renderAlerts(m) {
    var list = $('alert-list');
    var frag = document.createDocumentFragment();
    var now = new Set(m.alerts.map(function (a) { return a.id; }));
    var prev = state.knownAlerts;

    $('alert-count').textContent = String(m.alerts.length);
    $('alert-count').className = 'count' + (m.alerts.some(function (a) { return cls(a.status) === 'down'; }) ? ' hot' : '');

    if (!m.alerts.length) {
      var ok = el('li', 'all-clear');
      ok.appendChild(el('span', 'big', '✓'));
      ok.appendChild(el('span', null, 'All monitored sensors OK'));
      frag.appendChild(ok);
    }

    m.alerts.slice(0, CFG.maxAlerts).forEach(function (a) {
      var c = cls(a.status);
      var li = el('li', 'alert s-' + c + (prev && !prev.has(a.id) ? ' new' : ''));
      var row = el('div', 'a-top');
      row.appendChild(el('span', 'badge', label(a.status)));
      row.appendChild(el('span', 'a-dev', a.device));
      if (a.downSince) row.appendChild(el('span', 'a-since', a.downSince));
      li.appendChild(row);
      li.appendChild(el('div', 'a-sensor', a.name + (a.lastValue ? '  ·  ' + a.lastValue : '')));
      if (a.message && a.message !== 'OK') li.appendChild(el('div', 'a-msg', a.message));
      if (a.group) li.appendChild(el('div', 'a-group', a.group));
      frag.appendChild(li);
    });

    if (m.alerts.length > CFG.maxAlerts) {
      frag.appendChild(el('li', 'more', '+' + (m.alerts.length - CFG.maxAlerts) + ' more alerts'));
    }

    list.textContent = '';
    list.appendChild(frag);
    state.knownAlerts = now;
  }

  function render() {
    var m = model(state.data);
    renderSummary(m);
    renderSections(m);
    renderAlerts(m);
    document.title = (m.totals.down ? '(' + m.totals.down + ' DOWN) ' : '') + CFG.title;
  }

  // ------------------------------------------------------------------ status / clock
  function fmtAge(sec) {
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
  }

  function tick() {
    var now = new Date();
    $('clock-time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    $('clock-date').textContent = now.toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

    var banner = $('banner');
    var conn = $('conn');
    var sub = $('subtitle');

    if (!state.lastOkAt) {
      conn.className = 'conn ' + (state.lastError ? 'bad' : 'wait');
      sub.textContent = state.lastError ? 'No data: ' + state.lastError : 'Connecting to PRTG…';
      banner.hidden = !state.lastError;
      banner.textContent = state.lastError ? 'Cannot load data from PRTG: ' + state.lastError : '';
      return;
    }

    var age = Math.round((Date.now() - state.lastOkAt) / 1000);
    var stale = age > CFG.staleAfterSeconds;
    document.body.classList.toggle('stale', stale);
    conn.className = 'conn ' + (stale ? 'bad' : state.lastError ? 'warn' : 'ok');
    sub.textContent = (DEMO ? 'DEMO DATA · ' : '') + CFG.subtitle + ' · updated ' + fmtAge(age) + ' ago';

    if (stale) {
      banner.hidden = false;
      banner.className = 'banner bad';
      banner.textContent = 'DATA STALE - last good update ' + fmtAge(age) + ' ago. Status shown below may be wrong.' +
        (state.lastError ? ' (' + state.lastError + ')' : '');
    } else if (state.lastError) {
      banner.hidden = false;
      banner.className = 'banner warn';
      banner.textContent = 'Last refresh failed: ' + state.lastError + ' - showing data from ' + fmtAge(age) + ' ago';
    } else {
      banner.hidden = true;
    }
  }

  function cycle() {
    fetchState()
      .then(function (data) {
        state.data = data;
        state.lastOkAt = Date.now();
        state.lastError = '';
        render();
      })
      .catch(function (err) {
        state.lastError = err && err.name === 'AbortError' ? 'request timed out' : (err && err.message) || 'unknown error';
      })
      .finally(function () {
        tick();
        setTimeout(cycle, Math.max(5, CFG.refreshSeconds) * 1000);
      });
  }

  // Kiosk mode: if the device area doesn't fit the screen, scroll it slowly
  // top -> bottom -> top so nothing stays hidden on an unattended wall screen.
  function autoScroll() {
    var box = $('sections');
    var dir = 1, pauseUntil = Date.now() + 8000;
    setInterval(function () {
      if (Date.now() < pauseUntil) return;
      var max = box.scrollHeight - box.clientHeight;
      if (max <= 2) return;
      box.scrollTop += dir;
      if ((dir > 0 && box.scrollTop >= max - 1) || (dir < 0 && box.scrollTop <= 0)) {
        dir = -dir;
        pauseUntil = Date.now() + 8000;
      }
    }, 40);
  }

  $('title').textContent = CFG.title;
  if (params.has('kiosk')) autoScroll();
  tick();
  setInterval(tick, 1000);
  cycle();
})();
