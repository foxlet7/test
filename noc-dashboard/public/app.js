(function () {
  'use strict';

  var CFG = Object.assign({
    title: 'NOC Dashboard',
    subtitle: 'PRTG live status',
    refreshSeconds: 30,
    staleAfterSeconds: 120,
    reloadPageHours: 6,
    fitToScreen: 'auto', // grow text to fill the screen: true / false / 'auto' (= on for panels layout)
    fitMaxFontPx: 48,    // upper limit for fit-to-screen text size
    panelColumns: 0,     // panels per row; 0 = all panels in one row
    detailAutoCloseSeconds: 120, // graph panel closes itself after this long without interaction (0 = never)
    sections: [],
    panels: [],   // map-style layout: [{ title, items: [{ device, sensor, label }] }] - overrides sections
    unmatched: 'group',
    excludeGroups: [],
    hidePausedDevices: false,
    sortDevices: 'name',
    showHost: true,
    maxProblemsPerTile: 3,
    onlyIds: [],          // PRTG object IDs (sensors or devices) to show; empty = everything
    onlyTags: [],         // PRTG tags (on sensor or device) to show; empty = everything
    showAllSensors: 'auto', // list every sensor + value in tiles; 'auto' = on when a filter is set
    maxSensorsPerTile: 8,
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

  // Small localStorage wrapper: per-browser UI state; never required to work.
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // ---- views (presets): one page, several dashboards - NOC / VoIP / ... ----
  // Site files register them with (window.NOC_PRESETS ||= []).push({ key, label, ...config }).
  var PRESETS = window.NOC_PRESETS || [];
  var BASE = JSON.parse(JSON.stringify(CFG));
  var view = null;
  function applyPreset(key) {
    var p = PRESETS.filter(function (x) { return x.key === key; })[0] || PRESETS[0];
    if (!p) return;
    Object.keys(CFG).forEach(function (k) { if (!(k in BASE)) delete CFG[k]; });
    Object.keys(BASE).forEach(function (k) { CFG[k] = BASE[k]; });
    Object.keys(p).forEach(function (k) { CFG[k] = p[k]; });
    view = p.key;
  }
  applyPreset(params.get('view') || store.get('noc-view', null));
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
  var onlyIds = {};
  (CFG.onlyIds || []).forEach(function (i) { onlyIds[Number(i)] = true; });
  var onlyTags = (CFG.onlyTags || []).map(function (t) { return String(t).toLowerCase(); });
  var FILTERED = Object.keys(onlyIds).length > 0 || onlyTags.length > 0;
  var SHOW_ALL = CFG.showAllSensors === 'auto' ? FILTERED : Boolean(CFG.showAllSensors);

  function hasTag(list) {
    return list.some(function (t) { return onlyTags.indexOf(String(t).toLowerCase()) >= 0; });
  }

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

  function authQuery() {
    if (CFG.apiToken) return '&apitoken=' + encodeURIComponent(CFG.apiToken);
    if (CFG.username && CFG.passhash) {
      return '&username=' + encodeURIComponent(CFG.username) + '&passhash=' + encodeURIComponent(CFG.passhash);
    }
    return '';
  }

  function prtgTable(content, columns, signal, extra) {
    var url = (CFG.prtgBase || '') + '/api/table.json?content=' + content +
      '&output=json&count=50000&columns=' + columns + (extra || '') + authQuery();
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

  var PANEL_TAGS = [];
  [].concat(CFG.panels || [], PRESETS.reduce(function (a, p) { return a.concat(p.panels || []); }, [])).forEach(function (p) {
    (p.items || []).forEach(function (it) {
      if (it.tag && PANEL_TAGS.indexOf(String(it.tag).toLowerCase()) < 0) PANEL_TAGS.push(String(it.tag).toLowerCase());
    });
  });

  function fetchDirect(signal) {
    var tagReqs = PANEL_TAGS.map(function (t) {
      return prtgTable('sensors', 'objid', signal, '&filter_tags=' + encodeURIComponent('@tag(' + t + ')'))
        .then(function (r) { return [t, (r.sensors || []).map(function (s) { return Number(s.objid); })]; })
        .catch(function () { return [t, null]; });
    });
    return Promise.all([
      prtgTable('devices', DEVICE_COLS, signal),
      prtgTable('sensors', SENSOR_COLS, signal),
      Promise.all(tagReqs),
    ]).then(function (res) {
      var tagIds = {};
      res[2].forEach(function (pair) { if (pair[1]) tagIds[pair[0]] = pair[1]; });
      return {
        ok: true,
        tagIds: tagIds,
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
    if (DEMO && window.NOC_DEMO) return Promise.resolve(window.NOC_DEMO());

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

    var devById = {};
    devices.forEach(function (d) { devById[d.id] = d; });

    var sensors = data.sensors.filter(function (s) {
      if (!deviceIds[s.deviceId]) return false;
      if (!FILTERED) return true;
      var d = devById[s.deviceId];
      return onlyIds[s.id] || onlyIds[s.deviceId] || hasTag(s.tags) || hasTag(d.tags);
    });

    if (FILTERED) {
      // keep only devices that are selected themselves or have a selected sensor
      var keep = {};
      sensors.forEach(function (s) { keep[s.deviceId] = true; });
      devices = devices.filter(function (d) { return keep[d.id] || onlyIds[d.id] || hasTag(d.tags); });
    }
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
      devices: devices,
      sensors: sensors,
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

  // ------------------------------------------------------------------ map-style panels
  // Names are compared ignoring case and ALL whitespace, so "(065) ALULA -office-2"
  // matches "(065) ALULA - office-2". Wrap a value in /.../ to use a regex instead.
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

  // Items: { id }, { device }, { sensor [, device] }, { tag }; add expand: true
  // to list every sensor of the matched device(s) as its own row.
  function resolveItem(item, m) {
    var hits = resolveBase(item, m);
    if (!item.expand) return hits;
    var out = [];
    hits.forEach(function (h) {
      if (h.kind !== 'device') { out.push(h); return; }
      m.sensors
        .filter(function (s) { return s.deviceId === h.obj.id; })
        .sort(function (a, b) { return byName(a, b); })
        .forEach(function (s) { out.push({ kind: 'sensor', obj: s }); });
    });
    return out;
  }

  function resolveBase(item, m) {
    if (item.tag) {
      // PRTG's own tag filter (includes tags inherited from device/group); falls
      // back to the sensor's and device's own tags.
      var t = String(item.tag).toLowerCase();
      var fromPrtg = (state.data && state.data.tagIds && state.data.tagIds[t]) || null;
      var devTagged = {};
      m.devices.forEach(function (d) {
        if (d.tags.some(function (x) { return x.toLowerCase() === t; })) devTagged[d.id] = true;
      });
      return m.sensors
        .filter(function (s) {
          return (fromPrtg && fromPrtg.indexOf(s.id) >= 0) || devTagged[s.deviceId] ||
            s.tags.some(function (x) { return x.toLowerCase() === t; });
        })
        .sort(function (a, b) { return a.device.localeCompare(b.device) || byName(a, b); })
        .map(function (s) { return { kind: 'sensor', obj: s }; });
    }
    if (item.id != null) {
      // PRTG object ID: matches a sensor or a device (IDs are unique across PRTG)
      var id = Number(item.id);
      var sensor = m.sensors.filter(function (x) { return x.id === id; })[0];
      if (sensor) return [{ kind: 'sensor', obj: sensor }];
      var dev = m.devices.filter(function (x) { return x.id === id; })[0];
      return dev ? [{ kind: 'device', obj: dev }] : [];
    }
    var dm = item.device ? textMatcher(item.device, false) : null;
    if (item.sensor) {
      var sm = textMatcher(item.sensor, true);
      return m.sensors
        .filter(function (s) { return sm(s.name) && (!dm || dm(s.device)); })
        .map(function (s) { return { kind: 'sensor', obj: s }; });
    }
    if (!dm) return [];
    return m.devices
      .filter(function (d) { return dm(d.name); })
      .map(function (d) { return { kind: 'device', obj: d }; });
  }

  function deviceValue(d) {
    var parts = [];
    ['down', 'warn', 'unusual', 'ack', 'paused', 'up'].forEach(function (k) {
      if (d.counts[k]) parts.push(d.counts[k] + ' ' + (k === 'warn' ? 'warning' : k));
    });
    return parts.join(' · ') || 'no sensors';
  }

  function renderPanels(m) {
    var root = $('sections');
    var grid = el('div', 'panels');
    var shown = {}; // sensor ids represented on screen (for scope: 'panels')
    panelInfo = { panel: {}, label: {}, cap: {} };

    CFG.panels.forEach(function (panel) {
      var rows = [];
      var seen = {};
      var worst = 6;
      (panel.items || []).forEach(function (item) {
        var hits = resolveItem(item, m);
        if (!hits.length) {
          if (!item.optional) rows.push({ missing: true, item: item }); // optional: catch-all patterns stay silent
          return;
        }
        hits.forEach(function (h) {
          var key = h.kind + h.obj.id;
          if (seen[key]) return;
          seen[key] = true;
          if (h.kind === 'sensor') {
            shown[h.obj.id] = true;
            panelInfo.panel[h.obj.id] = panel.title;
            if (item.label && hits.length === 1) panelInfo.label[h.obj.id] = item.label;
            if (item.capacity) panelInfo.cap[h.obj.id] = Number(item.capacity);
          }
          else m.sensors.forEach(function (x) { if (x.deviceId === h.obj.id) shown[x.id] = true; });
          worst = Math.min(worst, RANK[cls(h.obj.status)]);
          rows.push({ hit: h, item: item, multi: hits.length > 1 });
        });
      });

      var worstCls = Object.keys(RANK).filter(function (k) { return RANK[k] === worst; })[0];
      var box = el('div', 'panel s-' + worstCls);
      var head = el('div', 'section-head');
      head.appendChild(el('h2', null, panel.title));
      head.appendChild(el('span', 'meta', rows.length + (rows.length === 1 ? ' item' : ' items')));
      box.appendChild(head);

      var ul = el('ul', 'rows');
      rows.forEach(function (r) {
        if (r.missing) {
          var miss = el('li', 'row missing');
          miss.appendChild(el('span', 'dot'));
          var t = el('div', 'lbl');
          t.appendChild(el('span', 'name', r.item.label || r.item.sensor || r.item.device ||
            (r.item.tag ? 'Tag "' + r.item.tag + '"' : 'ID ' + r.item.id)));
          t.appendChild(el('span', 'dev', r.item.tag ? 'no sensors carry this tag (or the PRTG user can\'t see them)' : 'not found in PRTG - check the name / user access'));
          miss.appendChild(t);
          ul.appendChild(miss);
          return;
        }
        var o = r.hit.obj;
        var c = cls(o.status);
        var li = el('li', 'row s-' + c);
        clickable(li, r.hit.kind, o.id);
        li.title = (r.hit.kind === 'sensor' ? o.device + ' › ' + o.name : o.name) + ' - ' + label(o.status) +
          (o.message && o.message !== 'OK' ? '\n' + o.message : '');
        li.appendChild(el('span', 'dot'));
        var body = el('div', 'lbl');
        var name = r.item.label && !r.multi ? r.item.label : o.name;
        body.appendChild(el('span', 'name', name));
        var line2 = el('div', 'line2');
        var sub = r.hit.kind === 'sensor' ? o.device : (CFG.showHost ? o.host : '');
        line2.appendChild(el('span', 'dev', sub || ''));
        if (c !== 'up') line2.appendChild(el('span', 'st', label(o.status)));
        line2.appendChild(el('span', 'v', r.hit.kind === 'sensor' ? (o.lastValue || '-') : deviceValue(o)));
        body.appendChild(line2);
        li.appendChild(body);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      grid.appendChild(box);
    });

    root.textContent = '';
    root.appendChild(grid);
    return shown;
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
    clickable(tile, 'device', d.id);
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

    var limit = SHOW_ALL ? CFG.maxSensorsPerTile : CFG.maxProblemsPerTile;
    var problems = SHOW_ALL ? d.sensors : d.sensors.filter(function (s) {
      var k = cls(s.status);
      return k !== 'up' && k !== 'paused';
    });
    if (problems.length && limit > 0) {
      var ul = el('ul', 'problems' + (SHOW_ALL ? ' all' : ''));
      problems.slice(0, limit).forEach(function (s) {
        var li = el('li', 's-' + cls(s.status));
        li.appendChild(el('span', 'pn', s.name));
        if (s.lastValue) li.appendChild(el('span', 'pv', s.lastValue));
        ul.appendChild(li);
      });
      if (problems.length > limit) {
        ul.appendChild(el('li', 'more', '+' + (problems.length - limit) + ' more'));
      }
      tile.appendChild(ul);
    }
    return tile;
  }

  // Dismissed alerts: { sensorId: status at dismissal }. An alert comes back
  // as soon as that sensor's status differs (worse, better, or recovered).
  var dismissed = store.get('noc-dismissed', {});
  var showDismissed = false;

  function pruneDismissed() {
    if (!state.data) return;
    var byId = {};
    state.data.sensors.forEach(function (s) { byId[s.id] = s; });
    var changed = false;
    Object.keys(dismissed).forEach(function (id) {
      var s = byId[id];
      if (!s || s.status !== dismissed[id]) { delete dismissed[id]; changed = true; }
    });
    if (changed) store.set('noc-dismissed', dismissed);
  }

  function alertItem(a, prev, isDismissed) {
    var c = cls(a.status);
    var li = el('li', 'alert s-' + c + (isDismissed ? ' dismissed' : '') + (!isDismissed && prev && !prev.has(a.id) ? ' new' : ''));
    clickable(li, 'sensor', a.id);
    var row = el('div', 'a-top');
    row.appendChild(el('span', 'badge', label(a.status)));
    row.appendChild(el('span', 'a-dev', a.device));
    if (a.downSince) row.appendChild(el('span', 'a-since', a.downSince));
    var btn = el('button', 'a-dismiss', isDismissed ? '↺' : '✓');
    btn.type = 'button';
    btn.title = isDismissed ? 'Restore this alert' : 'Dismiss - it comes back if the status changes';
    btn.setAttribute(isDismissed ? 'data-restore' : 'data-dismiss', String(a.id));
    row.appendChild(btn);
    li.appendChild(row);
    li.appendChild(el('div', 'a-sensor', a.name + (a.lastValue ? '  ·  ' + a.lastValue : '')));
    if (a.message && a.message !== 'OK') li.appendChild(el('div', 'a-msg', a.message));
    if (a.group) li.appendChild(el('div', 'a-group', a.group));
    return li;
  }

  function renderAlerts(m) {
    var list = $('alert-list');
    var frag = document.createDocumentFragment();
    var now = new Set(m.alerts.map(function (a) { return a.id; }));
    var prev = state.knownAlerts;

    pruneDismissed();
    var hidden = m.alerts.filter(function (a) { return a.id in dismissed; });
    var allAlerts = m.alerts;
    m = Object.assign({}, m, { alerts: m.alerts.filter(function (a) { return !(a.id in dismissed); }) });

    var hot = m.alerts.some(function (a) { return cls(a.status) === 'down'; });
    $('alert-count').textContent = String(m.alerts.length);
    $('alert-count').className = 'count' + (hot ? ' hot' : '');
    $('rail-count').textContent = String(m.alerts.length);
    $('rail-count').className = 'count' + (hot ? ' hot' : '');

    if (!m.alerts.length) {
      var ok = el('li', 'all-clear');
      ok.appendChild(el('span', 'big', '✓'));
      ok.appendChild(el('span', null, allAlerts.length ? 'No open alerts (' + hidden.length + ' dismissed)' : 'All monitored sensors OK'));
      frag.appendChild(ok);
    }

    m.alerts.slice(0, CFG.maxAlerts).forEach(function (a) { frag.appendChild(alertItem(a, prev, false)); });

    if (m.alerts.length > CFG.maxAlerts) {
      frag.appendChild(el('li', 'more', '+' + (m.alerts.length - CFG.maxAlerts) + ' more alerts'));
    }
    if (hidden.length) {
      var t = el('li', 'more');
      var tb = el('button', 'a-toggle', (showDismissed ? 'Hide ' : 'Show ') + hidden.length + ' dismissed');
      tb.type = 'button';
      tb.setAttribute('data-toggle-dismissed', '1');
      t.appendChild(tb);
      frag.appendChild(t);
      if (showDismissed) hidden.forEach(function (a) { frag.appendChild(alertItem(a, prev, true)); });
    }

    list.textContent = '';
    list.appendChild(frag);
    state.knownAlerts = now;
  }

  // scope: 'panels' -> counts and alerts only cover what this dashboard shows
  function scopeToPanels(m, shown) {
    var t = { down: 0, warn: 0, unusual: 0, ack: 0, paused: 0, up: 0, unknown: 0, all: 0 };
    var devs = {};
    m.sensors.forEach(function (s) {
      if (!shown[s.id]) return;
      t[cls(s.status)] += 1;
      t.all += 1;
      devs[s.deviceId] = true;
    });
    m.totals = t;
    m.deviceCount = Object.keys(devs).length;
    m.alerts = m.alerts.filter(function (a) { return shown[a.id]; });
  }

  function render() {
    var m = model(state.data);
    var shown = null;
    if (CFG.panels && CFG.panels.length) {
      shown = renderPanels(m);
      if (CFG.scope === 'panels') scopeToPanels(m, shown);
    } else {
      panelInfo = { panel: {}, label: {}, cap: {} };
      renderSections(m);
    }
    renderSummary(m);
    renderAlerts(m);
    if (INSIGHTS) renderInsights(m, shown);
    fitToScreen();
    if (detail.open) updateDetail();
    document.title = (m.totals.down ? '(' + m.totals.down + ' DOWN) ' : '') + (CFG.brandName ? CFG.brandName + ' ' : '') + CFG.title;
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

  // ------------------------------------------------------------------ insights strip
  // Live analysis of every bandwidth sensor on the screen, from the values
  // already polled. A rolling history (up to 6 h) is kept in this browser so
  // trends survive the periodic page reload.
  var panelInfo = { panel: {}, label: {}, cap: {} };
  var INSIGHTS = params.get('insights') !== '0' && CFG.insights !== false;
  var HIST_KEY = 'noc-hist';
  var HIST_MAX_MS = 6 * 3600 * 1000;
  var hist = (function () {
    try { return JSON.parse(localStorage.getItem(HIST_KEY)) || {}; } catch (e) { return {}; }
  })();
  var lastSampleAt = 0;

  // "1,234.5 kbit/s" / "151 Mbit/s" / "2 MByte/s" -> Mbit/s; null if not a bandwidth value
  function parseMbps(str) {
    var m = /([\d.,]+)\s*([kmgt]?)(bit|byte|b)\/s/i.exec(String(str || ''));
    if (!m) return null;
    var numStr = m[1];
    if (numStr.indexOf('.') >= 0 && numStr.indexOf(',') >= 0) numStr = numStr.replace(/,/g, '');
    else if (/,\d{3}(\D|$)/.test(numStr)) numStr = numStr.replace(/,/g, '');
    else numStr = numStr.replace(',', '.');
    var v = parseFloat(numStr);
    if (!isFinite(v)) return null;
    var mult = { '': 1e-6, k: 1e-3, m: 1, g: 1e3, t: 1e6 }[m[2].toLowerCase()];
    if (/byte/i.test(m[3]) || m[3] === 'B') mult *= 8;
    return v * mult;
  }

  function fmtMbps(v) {
    if (v == null) return '-';
    if (v >= 1000) return (v / 1000).toFixed(2) + ' Gbit/s';
    if (v >= 100) return Math.round(v) + ' Mbit/s';
    if (v >= 1) return v.toFixed(1) + ' Mbit/s';
    return Math.round(v * 1000) + ' kbit/s';
  }

  function linkName(s) { return panelInfo.label[s.id] || s.name; }

  function sample(links) {
    var now = Date.now();
    if (now - lastSampleAt < 15000) return; // one sample per data refresh
    lastSampleAt = now;
    links.forEach(function (l) {
      var arr = hist[l.s.id] || (hist[l.s.id] = []);
      arr.push([now, cls(l.s.status) === 'down' ? 0 : l.mbps]);
    });
    Object.keys(hist).forEach(function (k) {
      hist[k] = hist[k].filter(function (p) { return now - p[0] <= HIST_MAX_MS; });
      if (!hist[k].length) delete hist[k];
    });
    try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch (e) { /* storage full/blocked: keep in memory */ }
  }

  // average over [now-fromMin, now-toMin]
  function windowAvg(id, fromMin, toMin) {
    var now = Date.now();
    var pts = (hist[id] || []).filter(function (p) {
      var age = (now - p[0]) / 60000;
      return age <= fromMin && age >= toMin;
    });
    if (pts.length < 3) return null;
    return pts.reduce(function (a, p) { return a + p[1]; }, 0) / pts.length;
  }

  function historyMinutes() {
    var oldest = Infinity;
    Object.keys(hist).forEach(function (k) { if (hist[k].length) oldest = Math.min(oldest, hist[k][0][0]); });
    return isFinite(oldest) ? Math.round((Date.now() - oldest) / 60000) : 0;
  }

  function sparkline(id, w, h) {
    var pts = (hist[id] || []).slice(-120);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'spark');
    if (pts.length < 2) return svg;
    var max = Math.max.apply(null, pts.map(function (p) { return p[1]; })) || 1;
    var d = pts.map(function (p, i) {
      return (i ? 'L' : 'M') + (i / (pts.length - 1) * w).toFixed(1) + ' ' + (h - p[1] / max * (h - 2) - 1).toFixed(1);
    }).join(' ');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function analyse(links, m) {
    var f = []; // { sev 0..3, text, id }
    var drops = [], rises = [];
    links.forEach(function (l) {
      var s = l.s, c = cls(s.status), name = linkName(s);
      if (c === 'down' || c === 'ack') {
        f.push({ sev: 0, id: s.id, text: name + ' is DOWN' + (s.downSince ? ' for ' + s.downSince : '') + (s.message ? ' — ' + s.message : '') });
        return;
      }
      if (c === 'warn' || c === 'unusual') {
        f.push({ sev: 2, id: s.id, text: name + ': ' + label(s.status).toLowerCase() + (s.message ? ' — ' + s.message : '') });
      }
      var cap = panelInfo.cap[s.id];
      if (cap) {
        var pct = l.mbps / cap * 100;
        if (pct >= 90) f.push({ sev: 1, id: s.id, text: name + ' at ' + Math.round(pct) + '% of its ' + cap + ' Mbit/s — saturated' });
        else if (pct >= 75) f.push({ sev: 2, id: s.id, text: name + ' at ' + Math.round(pct) + '% of its ' + cap + ' Mbit/s — approaching capacity' });
      }
      var base = windowAvg(s.id, 30, 3);
      if (base != null) {
        if (base >= 2 && l.mbps < base * 0.2) {
          drops.push(l);
          f.push({ sev: 1, id: s.id, text: name + ' dropped from ' + fmtMbps(base) + ' to ' + fmtMbps(l.mbps) + ' (−' + Math.round((1 - l.mbps / base) * 100) + '%) — outage or failover?' });
        } else if (l.mbps >= 5 && l.mbps > base * 2.5) {
          rises.push(l);
          f.push({ sev: 2, id: s.id, text: name + ' surged to ' + fmtMbps(l.mbps) + ' (' + (l.mbps / Math.max(base, 0.001)).toFixed(1) + '× its 30-min average)' });
        } else if (base >= 1 && l.mbps > base * 1.5) {
          rises.push(l);
        }
      }
      var zeroSince = (hist[s.id] || []).filter(function (p) { return Date.now() - p[0] <= 15 * 60000; });
      if (l.mbps === 0 && zeroSince.length >= 10 && zeroSince.every(function (p) { return p[1] === 0; })) {
        f.push({ sev: 3, id: s.id, text: name + ' has carried no traffic for 15+ min — idle backup or disconnected?' });
      }
    });
    // a drop and a rise in the same box at the same time looks like failover
    drops.forEach(function (d) {
      var p = panelInfo.panel[d.s.id];
      rises.filter(function (r) { return panelInfo.panel[r.s.id] === p && r !== d; }).forEach(function (r) {
        f.push({ sev: 1, id: r.s.id, text: 'Traffic in ' + (p || 'this site') + ' appears to have moved from ' + linkName(d.s) + ' to ' + linkName(r.s) + ' (likely failover)' });
      });
    });
    return f.sort(function (a, b) { return a.sev - b.sev; });
  }

  function renderInsights(m, shown) {
    var box = $('insights');
    var links = m.sensors
      .filter(function (s) { return !shown || shown[s.id]; })
      .map(function (s) { return { s: s, mbps: parseMbps(s.lastValue) }; })
      .filter(function (l) { return l.mbps != null || (/traffic/i.test(l.s.name) && cls(l.s.status) === 'down'); })
      .map(function (l) { if (l.mbps == null) l.mbps = 0; return l; });
    // sample every bandwidth sensor, so each view has history when switched to
    sample(m.sensors
      .map(function (s) { return { s: s, mbps: parseMbps(s.lastValue) }; })
      .filter(function (l) { return l.mbps != null; }));
    if (!links.length) { box.hidden = true; return; }
    box.hidden = false;
    var mini = $('ins-mini');
    box = $('ins-body');
    box.textContent = '';

    var total = links.reduce(function (a, l) { return a + l.mbps; }, 0);
    var up = links.filter(function (l) { return cls(l.s.status) !== 'down' && cls(l.s.status) !== 'ack'; }).length;

    // 1. throughput now, per box
    var c1 = el('div', 'ins-card');
    c1.appendChild(el('h3', null, 'Throughput now'));
    c1.appendChild(el('div', 'ins-big', fmtMbps(total)));
    c1.appendChild(el('div', 'ins-sub', up + ' of ' + links.length + ' links up'));
    var byPanel = {};
    links.forEach(function (l) {
      var p = panelInfo.panel[l.s.id] || l.s.group || 'Other';
      byPanel[p] = (byPanel[p] || 0) + l.mbps;
    });
    var maxP = Math.max.apply(null, Object.keys(byPanel).map(function (k) { return byPanel[k]; })) || 1;
    var bars = el('div', 'ins-bars');
    Object.keys(byPanel).sort(function (a, b) { return byPanel[b] - byPanel[a]; }).forEach(function (k) {
      var row = el('div', 'ins-bar');
      row.appendChild(el('span', 'k', k));
      var track = el('span', 'track');
      var fill = el('span', 'fill');
      fill.style.width = Math.max(2, byPanel[k] / maxP * 100) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'v', fmtMbps(byPanel[k])));
      bars.appendChild(row);
    });
    c1.appendChild(bars);
    box.appendChild(c1);

    // 2. busiest links with trend
    var c2 = el('div', 'ins-card');
    c2.appendChild(el('h3', null, 'Busiest links'));
    var list = el('ol', 'ins-top');
    links.slice().sort(function (a, b) { return b.mbps - a.mbps; }).slice(0, CFG.insightsTopN || 5).forEach(function (l) {
      var li = el('li', 'clickable s-' + cls(l.s.status));
      clickable(li, 'sensor', l.s.id);
      var nm = el('span', 'k', linkName(l.s));
      li.appendChild(nm);
      li.appendChild(sparkline(l.s.id, 80, 18));
      var cap = panelInfo.cap[l.s.id];
      li.appendChild(el('span', 'v', fmtMbps(l.mbps) + (cap ? ' · ' + Math.round(l.mbps / cap * 100) + '%' : '')));
      list.appendChild(li);
    });
    c2.appendChild(list);
    box.appendChild(c2);

    // 3. findings
    var c3 = el('div', 'ins-card ins-findings');
    var mins = historyMinutes();
    var head = el('h3', null, 'Findings');
    head.appendChild(el('span', 'ins-note', mins < 10 ? 'learning baseline · ' + mins + ' min of history' : 'based on ' + (mins >= 120 ? Math.round(mins / 60) + ' h' : mins + ' min') + ' of history'));
    c3.appendChild(head);
    var findings = analyse(links, m);
    var ul = el('ul', 'ins-list');
    if (!findings.length) {
      ul.appendChild(el('li', 'ok', '✓ All ' + links.length + ' links look normal — no drops, surges or saturation detected'));
    }
    // one-line summary shown when the strip is collapsed
    mini.textContent = '';
    mini.className = 'ins-mini sev' + (findings.length ? findings[0].sev : 'ok');
    mini.appendChild(el('b', null, fmtMbps(total)));
    mini.appendChild(el('span', null, up + '/' + links.length + ' links up'));
    mini.appendChild(el('span', null, findings.length ? findings.length + ' finding' + (findings.length > 1 ? 's' : '') + ' — ' + findings[0].text : 'all links normal'));

    findings.slice(0, CFG.insightsMax || 6).forEach(function (x) {
      var li = el('li', 'sev' + x.sev + ' clickable');
      clickable(li, 'sensor', x.id);
      li.appendChild(el('span', 'pip'));
      li.appendChild(el('span', 't', x.text));
      ul.appendChild(li);
    });
    if (findings.length > (CFG.insightsMax || 6)) ul.appendChild(el('li', 'more', '+' + (findings.length - (CFG.insightsMax || 6)) + ' more'));
    c3.appendChild(ul);
    box.appendChild(c3);
  }

  // ------------------------------------------------------------------ detail panel (click a row)
  // Shows PRTG's own graph for the sensor (chart.svg, falling back to
  // chart.png) with Live / 2 days / 30 days / 365 days tabs.
  var GRAPHS = [['Live (2 h)', 0], ['2 days', 1], ['30 days', 2], ['365 days', 3]];
  var detail = { open: false, kind: null, id: null, sensorId: null, graph: 0, refresh: null, idle: null };

  function clickable(node, kind, id) {
    node.classList.add('clickable');
    node.setAttribute('data-kind', kind);
    node.setAttribute('data-id', String(id));
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
  }

  function onActivate(e) {
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (btn) {
      if (e.type === 'click') onButton(btn);
      return;
    }
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    var n = e.target.closest ? e.target.closest('.clickable') : null;
    if (!n) return;
    e.preventDefault();
    openDetail(n.getAttribute('data-kind'), Number(n.getAttribute('data-id')));
  }
  ['click', 'keydown'].forEach(function (t) {
    $('sections').addEventListener(t, onActivate);
    $('alert-list').addEventListener(t, onActivate);
    $('insights').addEventListener(t, onActivate);
  });

  function onButton(btn) {
    var id;
    if ((id = btn.getAttribute('data-dismiss'))) {
      var s = findSensor(Number(id));
      if (s) { dismissed[id] = s.status; store.set('noc-dismissed', dismissed); }
    } else if ((id = btn.getAttribute('data-restore'))) {
      delete dismissed[id];
      store.set('noc-dismissed', dismissed);
    } else if (btn.hasAttribute('data-toggle-dismissed')) {
      showDismissed = !showDismissed;
    } else return;
    if (state.data) render();
  }

  function findSensor(id) {
    return state.data ? state.data.sensors.filter(function (s) { return s.id === id; })[0] : null;
  }
  function findDevice(id) {
    return state.data ? state.data.devices.filter(function (d) { return d.id === id; })[0] : null;
  }
  function deviceSensors(devId) {
    return state.data ? state.data.sensors.filter(function (s) { return s.deviceId === devId; }) : [];
  }

  function currentSensor() {
    if (detail.kind === 'sensor') return findSensor(detail.id);
    var list = deviceSensors(detail.id);
    return list.filter(function (s) { return s.id === detail.sensorId; })[0] ||
      list.filter(function (s) { return /ping/i.test(s.name); })[0] || list[0] || null;
  }

  function armIdle() {
    clearTimeout(detail.idle);
    var secs = CFG.detailAutoCloseSeconds;
    if (secs > 0) detail.idle = setTimeout(closeDetail, secs * 1000);
  }

  function openDetail(kind, id) {
    detail.open = true;
    detail.kind = kind;
    detail.id = id;
    detail.sensorId = null;
    detail.graph = 0;
    $('detail').hidden = false;
    updateDetail();
    loadGraph();
    clearInterval(detail.refresh);
    detail.refresh = setInterval(function () { if (detail.graph === 0) loadGraph(); }, 60000);
    armIdle();
    $('detail-close').focus();
  }

  function closeDetail() {
    detail.open = false;
    $('detail').hidden = true;
    clearInterval(detail.refresh);
    clearTimeout(detail.idle);
    $('detail-graph').removeAttribute('src');
  }

  function updateDetail() {
    var s = currentSensor();
    var dev = detail.kind === 'device' ? findDevice(detail.id) : (s ? findDevice(s.deviceId) : null);
    var head = $('detail-head');
    head.textContent = '';
    if (!s && !dev) {
      head.appendChild(el('h2', null, 'No longer visible in PRTG'));
      return;
    }
    var c = cls(s ? s.status : dev.status);
    $('detail-card').className = 'detail-card s-' + c;

    var title = el('div', 'd-title');
    title.appendChild(el('span', 'dot'));
    title.appendChild(el('h2', null, s ? s.name : dev.name));
    title.appendChild(el('span', 'badge', label(s ? s.status : dev.status)));
    head.appendChild(title);

    var facts = el('div', 'd-facts');
    function fact(k, v) {
      if (!v) return;
      var f = el('div', 'fact');
      f.appendChild(el('span', 'k', k));
      f.appendChild(el('span', 'v', v));
      facts.appendChild(f);
    }
    fact('Device', dev ? dev.name + (dev.host ? '  (' + dev.host + ')' : '') : (s && s.device));
    fact('Group', (dev && dev.group) || (s && s.group));
    if (s) {
      fact('Last value', s.lastValue);
      fact('Message', s.message && s.message !== 'OK' ? s.message : 'OK');
      fact('Down for', s.downSince);
      fact('Sensor ID', '#' + s.id);
    }
    head.appendChild(facts);

    // device: let the user switch between its sensors
    var picker = $('detail-sensors');
    picker.textContent = '';
    if (detail.kind === 'device') {
      deviceSensors(detail.id).forEach(function (x) {
        var b = el('button', 'chip s-' + cls(x.status) + (s && x.id === s.id ? ' on' : ''), x.name);
        b.type = 'button';
        b.addEventListener('click', function () { detail.sensorId = x.id; updateDetail(); loadGraph(); armIdle(); });
        picker.appendChild(b);
      });
    }
    picker.hidden = detail.kind !== 'device';

    var tabs = $('detail-tabs');
    tabs.textContent = '';
    GRAPHS.forEach(function (g) {
      var b = el('button', 'tab' + (detail.graph === g[1] ? ' on' : ''), g[0]);
      b.type = 'button';
      b.addEventListener('click', function () { detail.graph = g[1]; updateDetail(); loadGraph(); armIdle(); });
      tabs.appendChild(b);
    });

    var link = $('detail-open');
    if (s) {
      link.href = (CFG.prtgBase || '') + '/sensor.htm?id=' + s.id;
      link.hidden = false;
    } else link.hidden = true;
  }

  function chartUrl(id, fmt) {
    var box = $('detail-graph-box');
    var w = Math.max(400, Math.min(2400, Math.round(box.clientWidth || 900)));
    var h = Math.max(220, Math.round(w * 0.42));
    return (CFG.prtgBase || '') + '/chart.' + fmt + '?type=graph&graphid=' + detail.graph + '&id=' + id +
      '&width=' + w + '&height=' + h + '&_=' + Date.now() + authQuery();
  }

  function loadGraph() {
    var s = currentSensor();
    var img = $('detail-graph');
    var msg = $('detail-graph-msg');
    msg.hidden = true;
    if (!s) { img.removeAttribute('src'); return; }
    if (DEMO || CFG.source !== 'prtg') {
      img.removeAttribute('src');
      msg.hidden = false;
      msg.textContent = DEMO ? 'Graphs are not available with demo data.' : 'Graphs need the single-file (direct PRTG) build.';
      return;
    }
    var triedPng = false;
    img.onerror = function () {
      if (!triedPng) { triedPng = true; img.src = chartUrl(s.id, 'png'); return; }
      img.removeAttribute('src');
      msg.hidden = false;
      msg.textContent = 'PRTG did not return a graph for this sensor. Use "Open in PRTG" to see it there.';
    };
    img.onload = function () { msg.hidden = true; };
    img.alt = s.name + ' graph';
    img.src = chartUrl(s.id, 'svg');
  }

  $('detail-close').addEventListener('click', closeDetail);
  $('detail').addEventListener('click', function (e) { if (e.target === $('detail')) closeDetail(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && detail.open) closeDetail(); });

  // Kiosk: hide the cursor only while the mouse is idle
  var mouseTimer;
  document.addEventListener('mousemove', function () {
    document.body.classList.remove('mouse-idle');
    clearTimeout(mouseTimer);
    mouseTimer = setTimeout(function () { document.body.classList.add('mouse-idle'); }, 4000);
    if (detail.open) armIdle();
  });

  // ------------------------------------------------------------------ fit to screen
  // Wall screens: find the largest root font size at which the device area
  // still fits without scrolling. Everything is sized in rem, so the whole
  // page scales together. ?zoom=1.5 forces a fixed size instead.
  var ZOOM = parseFloat(params.get('zoom'));
  var FIT = !ZOOM && (params.has('fit') || CFG.fitToScreen === true ||
    (CFG.fitToScreen === 'auto' && CFG.panels && CFG.panels.length > 0));
  if (ZOOM > 0) document.documentElement.style.fontSize = (16 * ZOOM) + 'px';

  function fitToScreen() {
    if (!FIT || window.innerWidth < 900) {
      if (FIT) document.documentElement.style.fontSize = '';
      return;
    }
    var root = document.documentElement;
    var box = $('sections');
    var grid = box.querySelector('.panels');
    var top = document.querySelector('.top');
    function clipped(n) {
      return n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1;
    }
    // Fits = no scrolling AND no name, value or heading cut off.
    function fits() {
      if (box.scrollHeight > box.clientHeight + 1) return false;
      if (root.scrollWidth > window.innerWidth || top.scrollWidth > top.clientWidth + 1) return false;
      // header parts must not overflow into each other
      var parts = top.children;
      for (var j = 0; j < parts.length; j++) {
        if (parts[j].scrollWidth > parts[j].clientWidth + 1) return false;
        var pr = parts[j].getBoundingClientRect();
        var kids = parts[j].children;
        for (var q = 0; q < kids.length; q++) {
          var kr = kids[q].getBoundingClientRect();
          if (kr.left < pr.left - 1 || kr.right > pr.right + 1) return false; // e.g. centred pills spilling both ways
        }
      }
      var must = box.querySelectorAll('.row .name, .row .v, .section-head h2');
      for (var i = 0; i < must.length; i++) if (clipped(must[i])) return false;
      return true;
    }
    function search() {
      var lo = 10, hi = CFG.fitMaxFontPx || 48;
      for (var i = 0; i < 14; i++) {
        var mid = (lo + hi) / 2;
        root.style.fontSize = mid + 'px';
        if (fits()) lo = mid; else hi = mid;
      }
      return Math.floor(lo * 10) / 10;
    }
    function setCols(c) { if (grid) grid.style.gridTemplateColumns = 'repeat(' + c + ', minmax(0, 1fr))'; }

    var n = grid ? CFG.panels.length : 0;
    var options = CFG.panelColumns ? [CFG.panelColumns] : [n, Math.ceil(n / 2), Math.ceil(n / 3)];
    var best = { size: 0, cols: options[0] };
    options.filter(function (c, i, a) { return c >= 1 && a.indexOf(c) === i; }).forEach(function (c) {
      setCols(c);
      var size = search();
      if (size > best.size + 0.5) best = { size: size, cols: c }; // prefer the wider (earlier) layout on ties
    });
    setCols(best.cols);
    root.style.fontSize = best.size + 'px';
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitToScreen, 200);
  });

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
  if (window.NOC_BUILD) $('build-stamp').textContent = 'build ' + window.NOC_BUILD;

  // Branding: CFG.theme adds a body class; CFG.logo is an image next to this page
  // in webroot (falls back to the CFG.wordmark text if the file is missing).
  if (CFG.theme) document.body.classList.add('theme-' + CFG.theme);
  (function () {
    var box = $('logo');
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
      img.onload = function () { box.hidden = false; fitToScreen(); };
      img.src = CFG.logo;
      box.appendChild(img);
    } else wordmark();
  })();

  // View switcher: presets in this page (instant), else links to other pages.
  // ?view=voip opens a view; ?rotate=60 cycles views on a wall screen.
  function markNav() {
    Array.prototype.forEach.call($('nav').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === view);
    });
  }
  function switchView(key) {
    if (!key || key === view) return;
    applyPreset(key);
    store.set('noc-view', view);
    if (detail.open) closeDetail();
    state.knownAlerts = null;
    $('title').textContent = CFG.title;
    markNav();
    try {
      var q = new URLSearchParams(location.search);
      q.set('view', view);
      history.replaceState(null, '', location.pathname + '?' + q.toString());
    } catch (e) { /* file:// etc. */ }
    if (state.data) render();
    tick();
  }
  (function () {
    var nav = $('nav');
    var rotate = parseInt(params.get('rotate'), 10);
    if (PRESETS.length > 1) {
      PRESETS.forEach(function (p) {
        var b = el('button', null, p.label || p.key);
        b.type = 'button';
        b.setAttribute('data-view', p.key);
        b.addEventListener('click', function () { switchView(p.key); });
        nav.appendChild(b);
      });
      markNav();
      nav.hidden = false;
      if (rotate >= 15) {
        setInterval(function () {
          if (detail.open || reportsOpen) return;
          var i = PRESETS.map(function (p) { return p.key; }).indexOf(view);
          switchView(PRESETS[(i + 1) % PRESETS.length].key);
        }, rotate * 1000);
      }
      return;
    }
    var links = CFG.links || [];
    if (!links.length) return;
    var here = location.pathname.split('/').pop();
    links.forEach(function (l) {
      var a = el('a', l.href === here ? 'on' : null, l.label);
      a.href = l.href + location.search;
      nav.appendChild(a);
    });
    nav.hidden = false;
    if (rotate >= 15) {
      var idx = links.map(function (l) { return l.href; }).indexOf(here);
      var nextHref = links[(idx + 1) % links.length].href;
      setInterval(function () {
        if (!detail.open && nextHref !== here) location.href = nextHref + location.search;
      }, rotate * 1000);
    }
  })();

  // Reports: the availability report page is embedded in this file (base64,
  // see build-standalone.js) and opened in an overlay iframe - same window,
  // same origin, so it reuses the PRTG access of this page.
  var reportsOpen = false;
  function openReports() {
    var src = document.getElementById('report-src');
    var frame = $('reports-frame');
    if (src && src.textContent.trim()) {
      var bytes = Uint8Array.from(atob(src.textContent.replace(/\s+/g, '')), function (c) { return c.charCodeAt(0); });
      var opts = JSON.stringify({ embedded: true, view: PRESETS.length > 1 ? view : 'all' }).replace(/</g, '\\u003c');
      frame.srcdoc = new TextDecoder('utf-8').decode(bytes)
        .replace('<head>', function () { return '<head><script>window.NOC_EMBED = ' + opts + ';<\/script>'; });
    } else {
      frame.src = (CFG.reportPage || 'noc-uptime.htm') + (view ? '?view=' + view : ''); // report page next to this one
    }
    $('reports').hidden = false;
    reportsOpen = true;
    if (detail.open) closeDetail();
  }
  function closeReports() {
    $('reports').hidden = true;
    reportsOpen = false;
    $('reports-frame').removeAttribute('srcdoc');
    $('reports-frame').removeAttribute('src');
  }
  $('reports-btn').addEventListener('click', openReports);
  $('reports-close').addEventListener('click', closeReports);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && reportsOpen) closeReports(); });

  // Collapsible side (alerts) and bottom (insights) panels, remembered per browser.
  // Keyboard: A = alerts panel, I = insights, V = next view.
  var ui = store.get('noc-ui', { side: true, bottom: true });
  function applyUi() {
    document.body.classList.toggle('side-collapsed', !ui.side);
    document.body.classList.toggle('ins-collapsed', !ui.bottom);
    $('side-toggle').setAttribute('aria-expanded', String(ui.side));
    $('ins-toggle').setAttribute('aria-expanded', String(ui.bottom));
    $('ins-toggle').textContent = '▾'; // rotated by CSS when collapsed
    $('ins-toggle').title = ui.bottom ? 'Collapse insights (I)' : 'Expand insights (I)';
    store.set('noc-ui', ui);
    // re-fit once the slide animation has finished (measuring mid-slide is wrong)
    clearTimeout(applyUi.t);
    applyUi.t = setTimeout(fitToScreen, 500);
  }
  function togglePanel(which) { ui[which] = !ui[which]; applyUi(); }
  $('side-toggle').addEventListener('click', function () { togglePanel('side'); });
  $('side-rail').addEventListener('click', function () { togglePanel('side'); });
  $('ins-toggle').addEventListener('click', function () { togglePanel('bottom'); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || detail.open || reportsOpen) return;
    var k = e.key.toLowerCase();
    if (k === 'r') { openReports(); return; }
    if (k === 'a') togglePanel('side');
    else if (k === 'i') togglePanel('bottom');
    else if (k === 'v' && PRESETS.length > 1) {
      var i = PRESETS.map(function (p) { return p.key; }).indexOf(view);
      switchView(PRESETS[(i + 1) % PRESETS.length].key);
    }
  });
  applyUi();

  if (params.has('kiosk')) autoScroll();
  if (params.has('kiosk')) document.body.classList.add('mouse-idle');
  if (CFG.reloadPageHours > 0) {
    setTimeout(function tryReload() {
      if (reportsOpen || detail.open) { setTimeout(tryReload, 60000); return; } // never interrupt a user
      location.reload();
    }, CFG.reloadPageHours * 3600 * 1000);
  }
  tick();
  setInterval(tick, 1000);
  cycle();
})();
