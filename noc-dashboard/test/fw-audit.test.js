'use strict';
// node test/fw-audit.test.js [policies.txt [objects.txt [hits.txt]]]
// With file arguments it prints the report for your own export instead of running the assertions.
const fs = require('fs');
const path = require('path');
const FW = require('../public/fw-core.js');
const rd = (f) => fs.readFileSync(f, 'utf8');
const args = process.argv.slice(2);

if (args.length) {
  const res = FW.analyse({ policies: rd(args[0]), objects: args[1] ? rd(args[1]) : '', hits: args[2] ? rd(args[2]) : '' });
  console.log(res.stats.total + ' policies, ' + res.stats.disabled + ' disabled\n');
  res.findings.forEach((f) => {
    console.log('[' + f.sev.toUpperCase() + '] ' + f.title + ' (' + f.items.length + ')');
    console.log('   ' + f.fix);
    f.items.slice(0, 40).forEach((i) => console.log('   - ' + i.id + ' ' + (i.name || '') + (i.note ? ' :: ' + i.note : '')));
  });
  if (res.script) console.log('\n' + res.script);
  process.exit(0);
}

const d = (f) => path.join(__dirname, f);
const res = FW.analyse({ policies: rd(d('fw-sample-policies.txt')), objects: rd(d('fw-sample-objects.txt')), hits: rd(d('fw-sample-hits.txt')) },
  { now: Date.parse('2026-10-22') });
const by = {};
res.findings.forEach((f) => { by[f.code] = f; });
const ids = (c) => (by[c] ? by[c].items.map((i) => i.id) : []);
let bad = 0;
function ok(cond, msg) { if (!cond) { bad++; console.error('FAIL', msg); } else console.log('ok  ', msg); }

ok(res.stats.total === 10 && res.stats.disabled === 1, 'parses 10 policies, 1 disabled');
ok(ids('DENYBYPASS').join() === '2', 'deny #2 is bypassed by earlier accepts');
ok(/#1/.test(by.DENYBYPASS.items[0].note), 'bypass note names #1');
ok(res.script.indexOf('move 2 before 1') >= 0, 'script moves #2 before #1');
ok(ids('SHADOW').join() === '10', '#10 is covered by earlier #4: ' + ids('SHADOW'));
ok(/ips profile never applies/.test(by.SHADOW.items[0].note), 'lost IPS profile reported');
ok(res.script.indexOf('edit 10') >= 0, 'script disables #10');
ok(ids('SVCEQV').join() === '3', '#3 service list equals ALL');
ok(ids('INALL').join() === '6', 'inbound ALL on #6');
ok(ids('UNTRUST').join() === '5', 'guest -> data-center flagged');
ok(ids('DISABLED').join() === '7', 'disabled #7');
ok(ids('NONAME').join() === '8', 'unnamed #8');
ok(ids('TESTGRP').indexOf(3) >= 0 && ids('TESTGRP').indexOf(8) >= 0, 'MFATEST group flagged');
ok(ids('VPNBROAD').join() === '8', 'wide vpn rule #8');
ok(ids('NOLOG').join() === '9', 'logging disabled on #9');
ok(ids('UNUSED').indexOf(5) >= 0, 'hit file: #5 unused');
ok(ids('STALE').join() === '3', 'hit file: #3 stale');
ok(!!by.OBJUNREF && by.OBJUNREF.items.some((i) => i.name === 'Unused-Host'), 'unreferenced object found');
ok(!!by.OBJDUP, 'duplicate address objects found');
ok(!!by.NOFINAL, 'missing final deny noted');
ok(FW.toCsv(res).split('\r\n').length > 10, 'csv has rows');
try { FW.analyse({ policies: 'nothing here' }); ok(false, 'rejects junk'); } catch (e) { ok(/No "config firewall policy"/.test(e.message), 'rejects junk input'); }
process.exit(bad ? 1 : 0);
