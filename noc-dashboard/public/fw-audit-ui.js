(function () {
  'use strict';

  var last = null;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  $('o-wan').value = FWAudit.DEFAULTS.wan;
  $('o-untrusted').value = FWAudit.DEFAULTS.untrusted;
  $('o-sensitive').value = FWAudit.DEFAULTS.sensitive;
  $('o-stale').value = FWAudit.DEFAULTS.staleDays;

  ['policies', 'hits', 'objects'].forEach(function (id) {
    $('f-' + id).addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { $(id).value = String(r.result); };
      r.readAsText(f);
    });
  });

  var SEVNAME = { high: 'High', med: 'Medium', low: 'Low', info: 'Note' };

  function render(res) {
    var s = res.stats, k = $('kpis');
    k.textContent = '';
    function kpi(n, l, cls) {
      var d = el('div', 'kpi ' + (cls || ''));
      d.appendChild(el('div', 'n', String(n)));
      d.appendChild(el('div', 'l', l));
      k.appendChild(d);
    }
    kpi(s.total, 'Policies (' + s.disabled + ' disabled)');
    kpi(s.counts.high, 'High-risk findings', s.counts.high ? 'bad' : 'good');
    kpi(s.counts.med, 'Medium findings', s.counts.med ? 'warn' : 'good');
    kpi(s.counts.low, 'Low / hygiene findings');
    kpi(s.inbound + ' / ' + s.egress, 'Internet-facing / internet-bound rules');
    if (s.hasHits) kpi(s.hitCover + ' / ' + s.total, 'Policies with hit data', s.hitCover ? '' : 'warn');
    k.hidden = false;

    var out = $('out');
    out.textContent = '';

    if (res.script) {
      var sp = el('section', 'panel');
      sp.appendChild(el('h2', null, 'Review script (CLI)'));
      sp.appendChild(el('p', 'warnbox',
        'Back up the config first (System > Config > Backup). This is a starting point, not an instruction: read every line, run it in a maintenance window. ' +
        '"move" lines put block rules above the accept rules that bypass them; "disable" lines turn off rules that never match or have no hits (disable, do not delete, and watch for a business cycle).'));
      var pre = el('pre', 'script', res.script);
      sp.appendChild(pre);
      var ba = el('div', 'bar-actions');
      var cb = el('button', null, 'Copy script');
      cb.type = 'button';
      cb.addEventListener('click', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(res.script);
        else { var r = document.createRange(); r.selectNodeContents(pre); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy'); }
        cb.textContent = 'Copied';
      });
      ba.appendChild(cb);
      sp.appendChild(ba);
      out.appendChild(sp);
    }

    res.findings.forEach(function (f, i) {
      var d = el('details', 'panel finding');
      if (f.sev === 'high' || i < 3) d.open = true;
      var sum = el('summary');
      var h = el('h2');
      h.appendChild(el('span', 'sev ' + f.sev, SEVNAME[f.sev]));
      h.appendChild(document.createTextNode(f.title));
      h.appendChild(el('span', 'count', f.items.length + (f.items.length === 1 ? ' item' : ' items')));
      sum.appendChild(h);
      d.appendChild(sum);
      d.appendChild(el('p', 'why', f.why));
      var fx = el('p', 'fix');
      fx.appendChild(el('b', null, 'Do: '));
      fx.appendChild(document.createTextNode(f.fix));
      d.appendChild(fx);
      var t = el('table', 'fw');
      var hr = el('tr');
      ['ID', 'Name', 'Detail'].forEach(function (c) { hr.appendChild(el('th', null, c)); });
      var th = el('thead'); th.appendChild(hr); t.appendChild(th);
      var tb = el('tbody');
      f.items.forEach(function (it) {
        var tr = el('tr');
        tr.appendChild(el('td', 'id', String(it.id)));
        tr.appendChild(el('td', null, it.name || (res.byId[it.id] ? res.byId[it.id].name : '')));
        tr.appendChild(el('td', 'note', it.note));
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      d.appendChild(t);
      out.appendChild(d);
    });

    var foot = $('foot');
    foot.hidden = false;
    var notes = [];
    if (!s.hasHits) notes.push('No hit counts supplied: unused-policy detection is off.');
    if (!s.hasObjects) notes.push('No objects supplied: overlap detection compares object names, not the addresses behind them.');
    if (s.multiVdom) notes.push('More than one "config firewall policy" block was found; analyse one VDOM at a time.');
    foot.textContent = 'Read-only analysis of pasted text; nothing was sent anywhere or changed on the firewall. Overlap logic is approximate ' +
      '(it ignores zones, geo, internet-service objects and rules that use negation; those rules are skipped). ' + notes.join(' ') +
      ' Generated ' + new Date().toLocaleString() + '.';
    $('csv').disabled = false;
    $('print').disabled = false;
  }

  $('go').addEventListener('click', function () {
    $('error').hidden = true;
    try {
      last = FWAudit.analyse({
        policies: $('policies').value, hits: $('hits').value, objects: $('objects').value,
      }, {
        wan: $('o-wan').value, untrusted: $('o-untrusted').value, sensitive: $('o-sensitive').value,
        staleDays: Number($('o-stale').value) || 90,
      });
      render(last);
    } catch (err) {
      $('error').hidden = false;
      $('error').textContent = err.message;
    }
  });
  $('csv').addEventListener('click', function () {
    if (!last) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + FWAudit.toCsv(last)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'firewall-audit.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $('print').addEventListener('click', function () { window.print(); });
  $('clear').addEventListener('click', function () {
    ['policies', 'hits', 'objects'].forEach(function (id) { $(id).value = ''; });
    $('out').textContent = ''; $('kpis').hidden = true; $('foot').hidden = true; $('error').hidden = true;
    $('csv').disabled = true; $('print').disabled = true; last = null;
  });
})();
