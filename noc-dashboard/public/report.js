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
    return Promise.all([
      api('/api/table.json?content=devices&output=json&count=50000&columns=objid,device,host'),
      api('/api/table.json?content=sensors&output=json&count=50000&columns=objid,parentid,device,sensor'),
    ]).then(function (r) {
      return {
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

  function resolve(item, inv) {
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

  function history(sensorId, start, end) {
    if (DEMO) return Promise.resolve(window.NOC_REPORT_DEMO.history(sensorId, start, end));
    var path = '/api/historicdata.json?id=' + sensorId + '&avg=' + DAY +
      '&sdate=' + prtgDate(start) + '&edate=' + prtgDate(end);
    var attempt = 0;
    function go() {
      return api(path).catch(function (err) {
        // PRTG throttles historic-data requests; back off and retry.
        if (err.retryable && attempt < CFG.historyRetries) {
          attempt += 1;
          setProgress('PRTG is throttling history requests - waiting ' + CFG.historyRetryWaitSeconds + 's (retry ' + attempt + ')…');
          return sleep(CFG.historyRetryWaitSeconds * 1000).then(go);
        }
        throw err;
      });
    }
    return go();
  }

  function availability(hist) {
    var rows = (hist.histdata || []).filter(function (r) {
      return !/sum|average|total/i.test(String(r.datetime || ''));
    });
    if (!rows.length) return { error: 'no history for this period' };

    var downKey = Object.keys(rows[0]).filter(function (k) { return /^downtime$/i.test(k); })[0];
    if (!downKey) {
      return { error: 'PRTG returned no "Downtime" column (columns: ' + Object.keys(rows[0]).slice(0, 8).join(', ') + ')' };
    }

    var monitored = 0, down = 0;
    rows.forEach(function (r) {
      var cov = r.coverage_raw != null ? Number(r.coverage_raw) / 100 : parsePct(r.coverage);
      if (cov == null || !isFinite(cov)) cov = 100;
      var dt = parsePct(r[downKey]);
      if (dt == null) dt = parsePct(r[downKey + '(RAW)']);
      if (dt == null) dt = 0;
      var secs = DAY * Math.min(Math.max(cov, 0), 100) / 100;
      monitored += secs;
      down += secs * Math.min(Math.max(dt, 0), 100) / 100;
    });

    var periodSecs = rows.length * DAY;
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
  function run(monthStr, sla) {
    var y = Number(monthStr.slice(0, 4)), m = Number(monthStr.slice(5, 7));
    var start = new Date(y, m - 1, 1, 0, 0, 0);
    var end = new Date(y, m, 1, 0, 0, 0);
    var now = new Date();
    var partial = end > now;
    if (partial) end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    if (end <= start) return Promise.reject(new Error('That month has not started yet.'));

    var label = start.toLocaleDateString([], { month: 'long', year: 'numeric' });
    $('period').textContent = label + (partial ? ' (month to date, up to ' + end.toLocaleDateString() + ')' : '') +
      ' · SLA target ' + sla + '%';

    setProgress('Loading PRTG inventory…');
    return loadInventory().then(function (inv) {
      var jobs = [];
      var panels = (CFG.panels || []).map(function (p) {
        var rows = [];
        (p.items || []).forEach(function (item) {
          var hits = resolve(item, inv);
          if (!hits.length) rows.push({ item: item, missing: 'not found in PRTG' });
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
        return history(row.sensor.id, start, end)
          .then(function (h) { row.result = availability(h); })
          .catch(function (e) { row.result = { error: e.message }; })
          .then(next);
      }
      return next().then(function () {
        setProgress('');
        return { panels: panels, label: label, partial: partial, start: start, end: end, sla: sla };
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
        name.appendChild(document.createTextNode(r.item.label && !r.multi ? r.item.label : (r.sensor ? r.sensor.name : (r.item.label || r.item.sensor || r.item.device || 'ID ' + r.item.id))));
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
    foot.textContent = 'Source: PRTG historic data (daily averages), ' + res.start.toLocaleString() + ' – ' + res.end.toLocaleString() +
      '. Availability = 100% − PRTG "Downtime", over the time each sensor was actually monitored (paused time excluded). ' +
      'Devices are measured by their Ping sensor. Generated ' + new Date().toLocaleString() + (DEMO ? ' · DEMO DATA' : '') + '.';

    document.title = CFG.title + ' – Availability ' + res.label;
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

  // ------------------------------------------------------------------ wire up
  var prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
  $('month').value = params.get('month') || (prev.getFullYear() + '-' + pad(prev.getMonth() + 1));
  $('sla').value = params.get('sla') || CFG.slaTarget;
  $('title').textContent = CFG.title.replace(/\s*NOC$/i, '') + ' – Availability Report';

  $('controls').addEventListener('submit', function (e) {
    e.preventDefault();
    showError('');
    $('go').disabled = true;
    var sla = parseFloat($('sla').value) || CFG.slaTarget;
    run($('month').value, sla)
      .then(function (res) { lastResult = res; render(res); })
      .catch(function (err) { setProgress(''); showError(err.message || String(err)); })
      .then(function () { $('go').disabled = false; });
  });

  $('csv').addEventListener('click', function () {
    if (!lastResult) return;
    var blob = new Blob(['﻿' + toCsv(lastResult)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'availability-' + $('month').value + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  $('print').addEventListener('click', function () { window.print(); });

  if (params.has('auto') || DEMO) $('controls').requestSubmit();
  if (params.has('demo') && !DEMO) showError('Demo data is not bundled in this build.');
})();
