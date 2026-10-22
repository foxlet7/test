(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FWAudit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * FortiGate policy audit engine. Pure functions, no network, no DOM.
   * Input is the text of `show firewall policy` (plus, optionally, the object
   * configs and hit counts). Output is a list of findings and a review script.
   */

  // ------------------------------------------------------------------ parsing
  function tokenize(s) {
    var out = [], re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)/g, m;
    while ((m = re.exec(s))) {
      out.push(m[1] != null ? m[1].replace(/\\(.)/g, '$1') : m[2] != null ? m[2] : m[3]);
    }
    return out;
  }

  // Generic FortiOS CLI parser: returns [{path, entries:[{id, props}]}]
  function parseConfig(text) {
    var sections = [], cur = null, entry = null, skip = 0;
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var t = tokenize(line), k = t[0];
      if (skip) { if (k === 'config') skip++; else if (k === 'end') skip--; return; }
      if (k === 'config') {
        if (entry) { skip = 1; return; }              // nested config inside an entry
        cur = { path: t.slice(1).join(' '), entries: [] };
        sections.push(cur);
      } else if (k === 'edit' && cur) {
        if (cur.path === 'vdom') return;               // multi-vdom wrapper
        entry = { id: t[1], props: {} };
        cur.entries.push(entry);
      } else if (k === 'next') {
        entry = null;
      } else if (k === 'end') {
        entry = null; cur = null;
      } else if ((k === 'set' || k === 'append') && entry && t.length > 1) {
        entry.props[t[1]] = k === 'append' ? (entry.props[t[1]] || []).concat(t.slice(2)) : t.slice(2);
      } else if (k === 'unset' && entry) {
        delete entry.props[t[1]];
      }
    });
    return sections;
  }

  var PROFILE_KEYS = ['av-profile', 'ips-sensor', 'webfilter-profile', 'application-list', 'dnsfilter-profile',
    'emailfilter-profile', 'dlp-profile', 'dlp-sensor', 'file-filter-profile', 'voip-profile', 'waf-profile',
    'profile-group'];
  var COMPLEX_KEYS = ['srcaddr-negate', 'dstaddr-negate', 'service-negate', 'internet-service',
    'internet-service-src', 'internet-service-negate', 'internet-service-src-negate'];

  function normPolicy(e, pos) {
    var p = e.props;
    function arr(k) { return p[k] ? p[k].slice() : []; }
    function one(k, d) { return p[k] && p[k].length ? p[k][0] : d; }
    var pol = {
      id: /^\d+$/.test(e.id) ? Number(e.id) : e.id, pos: pos,
      name: one('name', ''), enabled: one('status', 'enable') !== 'disable',
      action: one('action', 'deny'),
      srcintf: arr('srcintf'), dstintf: arr('dstintf'), srcaddr: arr('srcaddr'), dstaddr: arr('dstaddr'),
      service: arr('service'), schedule: one('schedule', 'always'),
      users: arr('users'), groups: arr('groups'), fsso: arr('fsso-groups'),
      ssl: one('ssl-ssh-profile', ''), nat: one('nat', 'disable') === 'enable',
      log: one('logtraffic', 'utm'), comments: (p.comments || []).join(' '),
      profiles: {}, raw: p,
    };
    PROFILE_KEYS.forEach(function (k) { if (p[k] && p[k].length) pol.profiles[k] = p[k][0]; });
    pol.hasUtm = Object.keys(pol.profiles).length > 0;
    pol.complex = COMPLEX_KEYS.some(function (k) { return one(k, 'disable') === 'enable'; }) ||
      !pol.srcaddr.length || !pol.dstaddr.length;
    pol.ident = pol.users.concat(pol.groups, pol.fsso).map(function (s) { return s.toLowerCase(); });
    return pol;
  }

  function policiesFrom(sections) {
    var out = [];
    sections.forEach(function (s) {
      if (s.path === 'firewall policy') s.entries.forEach(function (e) { out.push(normPolicy(e, out.length)); });
    });
    return out;
  }

  function indexObjects(sections) {
    var o = { address: {}, addrgrp: {}, service: {}, svcgrp: {}, vip: {}, count: 0 };
    var map = { 'firewall address': 'address', 'firewall addrgrp': 'addrgrp', 'firewall service custom': 'service',
      'firewall service group': 'svcgrp', 'firewall vip': 'vip', 'firewall vipgrp': 'addrgrp' };
    sections.forEach(function (s) {
      var t = map[s.path];
      if (!t) return;
      s.entries.forEach(function (e) { o[t][e.id] = e.props; o.count++; });
    });
    return o;
  }

  // ----------------------------------------------------------- hit counters
  function relDays(txt) {
    var m = /(\d+)\s*(second|minute|hour|day|week|month|year)/i.exec(txt);
    if (!m) return null;
    var n = Number(m[1]), u = m[2].toLowerCase();
    return n * ({ second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 })[u];
  }
  function ageDays(txt, now) {
    txt = String(txt || '').trim();
    if (!txt) return null;
    if (/^(n\/a|never|-)$/i.test(txt)) return Infinity;
    if (/^\d{9,10}$/.test(txt)) return (now - Number(txt) * 1000) / 86400000;
    var rel = relDays(txt);
    if (rel != null) return rel;
    var d = Date.parse(txt.replace(/^(\d{4}-\d\d-\d\d)\s+/, '$1T'));
    return isNaN(d) ? null : (now - d) / 86400000;
  }

  // Accepts: (a) `diagnose firewall iprope show/list` blocks, (b) CSV exported from the GUI
  // (ID + Hit Count [+ Last Used] columns), (c) simple lines "ID hits [last used]".
  function parseHits(text, now) {
    var hits = {}, lines = String(text || '').split(/\r?\n/);
    now = now || Date.now();
    function put(id, n, last) {
      id = Number(id);
      if (!isFinite(id)) return;
      hits[id] = { hits: n, ageDays: last == null ? null : ageDays(last, now) };
    }
    // (a) iprope blocks
    if (/policy index\s*=/i.test(text)) {
      String(text).split(/(?=policy index\s*=)/i).forEach(function (blk) {
        var id = /policy index\s*=\s*(\d+)/i.exec(blk);
        if (!id) return;
        var h = /hit\s*count\s*[:=]\s*(\d+)/i.exec(blk);
        var l = /last(?:\s*(?:hit|used))?\s*[:=]\s*([^\r\n]+?)(?:\s{2,}|$)/im.exec(blk);
        if (h) put(id[1], Number(h[1]), l ? l[1] : null);
      });
      return hits;
    }
    // (b) CSV with a header
    var hdr = lines[0] ? lines[0].split(/[,;\t]/).map(function (c) { return c.replace(/^"|"$/g, '').trim().toLowerCase(); }) : [];
    var ci = hdr.indexOf('id'), ch = -1, cl = -1;
    hdr.forEach(function (c, i) { if (/hit/.test(c)) ch = i; if (/last/.test(c)) cl = i; });
    if (ci >= 0 && ch >= 0) {
      lines.slice(1).forEach(function (ln) {
        if (!ln.trim()) return;
        var c = ln.split(/[,;\t]/).map(function (x) { return x.replace(/^"|"$/g, '').trim(); });
        var n = Number(String(c[ch]).replace(/[^\d]/g, ''));
        if (isFinite(n)) put(c[ci], n, cl >= 0 ? c[cl] : null);
      });
      return hits;
    }
    // (c) plain lines
    lines.forEach(function (ln) {
      var m = /^\s*(\d+)[\s,;\t]+(\d+)(?:[\s,;\t]+(.+))?$/.exec(ln);
      if (m) put(m[1], Number(m[2]), m[3]);
    });
    return hits;
  }

  // ---------------------------------------------------- address / service sets
  function ip2n(s) {
    var m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
    return m ? ((+m[1] * 256 + +m[2]) * 256 + +m[3]) * 256 + +m[4] : null;
  }
  function netAtom(ip, mask) {
    var a = ip2n(ip), mk = ip2n(mask);
    if (a == null) return null;
    if (mask && /^\d+$/.test(mask)) mk = 4294967296 - Math.pow(2, 32 - Number(mask));
    if (mk == null) mk = 4294967295;
    var size = 4294967296 - mk;
    if (size >= 4294967296) return { any: true };
    var lo = Math.floor(a / size) * size;
    return { lo: lo, hi: lo + size - 1 };
  }
  function addrAtoms(name, objs, seen) {
    if (name.toLowerCase() === 'all') return [{ any: true }];
    seen = seen || {};
    var o = objs && objs.address[name], g = objs && objs.addrgrp[name];
    if (o) {
      var type = (o.type && o.type[0]) || 'ipmask';
      if (type === 'ipmask') {
        var a = netAtom((o.subnet || [])[0], (o.subnet || [])[1]);
        return [a || { sym: 'addr:' + name }];
      }
      if (type === 'iprange') {
        var lo = ip2n((o['start-ip'] || [])[0]), hi = ip2n((o['end-ip'] || [])[0]);
        return [lo != null && hi != null ? { lo: lo, hi: hi } : { sym: 'addr:' + name }];
      }
      return [{ sym: type + ':' + ((o.fqdn || o['wildcard-fqdn'] || o.country || [name])[0]).toLowerCase() }];
    }
    if (g && !seen[name]) {
      seen[name] = true;
      var out = [];
      (g.member || []).forEach(function (m) { out = out.concat(addrAtoms(m, objs, seen)); });
      return out;
    }
    if (objs && objs.vip[name]) return [{ sym: 'vip:' + name }];
    var m = /^(\d+\.\d+\.\d+\.\d+)(?:\/(\d+))?$/.exec(name);
    if (m) return [netAtom(m[1], m[2] || '32')];
    return [{ sym: 'name:' + name }];
  }
  function atomsOf(list, objs) {
    var out = [];
    list.forEach(function (n) { out = out.concat(addrAtoms(n, objs)); });
    return out;
  }
  function atomCovers(a, b) {
    if (a.any) return true;
    if (b.any) return false;
    if (a.sym || b.sym) return a.sym === b.sym;
    return a.lo <= b.lo && a.hi >= b.hi;
  }
  function atomOverlaps(a, b) {
    if (a.any || b.any) return true;
    if (a.sym || b.sym) return a.sym === b.sym;
    return a.lo <= b.hi && b.lo <= a.hi;
  }
  function setCovers(A, B) {
    return B.every(function (b) { return A.some(function (a) { return atomCovers(a, b); }); });
  }
  function setOverlaps(A, B) {
    return A.some(function (a) { return B.some(function (b) { return atomOverlaps(a, b); }); });
  }
  function isAnyAddr(atoms) { return atoms.some(function (a) { return a.any; }); }

  // Protocols of well-known predefined services (null = unknown)
  var PREDEF = {
    HTTP: ['tcp'], HTTPS: ['tcp'], FTP: ['tcp'], SSH: ['tcp'], TELNET: ['tcp'], SMTP: ['tcp'], SMTPS: ['tcp'],
    POP3: ['tcp'], POP3S: ['tcp'], IMAP: ['tcp'], IMAPS: ['tcp'], LDAP: ['tcp'], LDAPS: ['tcp'], RDP: ['tcp'],
    'MS-SQL': ['tcp'], MYSQL: ['tcp'], SMB: ['tcp'], SAMBA: ['tcp'], IRC: ['tcp'], SCCP: ['tcp'], H323: ['tcp'],
    DNS: ['tcp', 'udp'], KERBEROS: ['tcp', 'udp'], SNMP: ['tcp', 'udp'], SIP: ['tcp', 'udp'], RTSP: ['tcp', 'udp'],
    NTP: ['udp'], DHCP: ['udp'], DHCP6: ['udp'], TFTP: ['udp'], SYSLOG: ['udp'], RADIUS: ['udp'], LDAP_UDP: ['udp'],
    PING: ['icmp'], ALL_ICMP: ['icmp'], ALL_ICMP6: ['icmp'], TRACEROUTE: ['udp'],
  };
  function svcProtos(name, objs) {
    var o = objs && objs.service[name];
    if (o) {
      var proto = ((o.protocol || [])[0] || '').toUpperCase();
      if (proto === 'ICMP') return ['icmp'];
      if (proto.indexOf('TCP') >= 0 || proto.indexOf('UDP') >= 0) {
        var p = [];
        if ((o['tcp-portrange'] || []).length) p.push('tcp');
        if ((o['udp-portrange'] || []).length) p.push('udp');
        return p.length ? p : null;
      }
      return null;
    }
    return PREDEF[name] || PREDEF[name.toUpperCase()] || null;
  }
  function svcSet(list, objs, seen) {
    var s = { all: false, tcp: false, udp: false, icmp: false, items: [] };
    seen = seen || {};
    list.forEach(function (n) {
      var u = n.toUpperCase();
      if (u === 'ALL') s.all = true;
      else if (u === 'ALL_TCP') s.tcp = true;
      else if (u === 'ALL_UDP') s.udp = true;
      else if (u === 'ALL_ICMP' || u === 'ALL_ICMP6') s.icmp = true;
      else if (objs && objs.svcgrp[n] && !seen[n]) {
        seen[n] = true;
        var sub = svcSet(objs.svcgrp[n].member || [], objs, seen);
        s.all = s.all || sub.all; s.tcp = s.tcp || sub.tcp; s.udp = s.udp || sub.udp; s.icmp = s.icmp || sub.icmp;
        s.items = s.items.concat(sub.items);
      } else s.items.push({ name: n, protos: svcProtos(n, objs) });
    });
    return s;
  }
  function svcCovers(A, B) {
    if (A.all) return true;
    if (B.all) return false;
    if ((B.tcp && !A.tcp) || (B.udp && !A.udp) || (B.icmp && !A.icmp)) return false;
    return B.items.every(function (b) {
      return A.items.some(function (a) { return a.name === b.name; }) ||
        (b.protos && b.protos.every(function (p) { return A[p]; }));
    });
  }
  function svcOverlaps(A, B) {
    if (A.all || B.all) return true;
    if (A.items.some(function (a) { return B.items.some(function (b) { return a.name === b.name; }); })) return true;
    return ['tcp', 'udp', 'icmp'].some(function (p) {
      function has(S) { return S[p] || S.items.some(function (i) { return !i.protos || i.protos.indexOf(p) >= 0; }); }
      return (A[p] || B[p]) && has(A) && has(B);
    });
  }
  function ifCovers(A, B) { return A.indexOf('any') >= 0 || B.every(function (b) { return A.indexOf(b) >= 0; }); }
  function ifOverlaps(A, B) {
    return A.indexOf('any') >= 0 || B.indexOf('any') >= 0 || A.some(function (a) { return B.indexOf(a) >= 0; });
  }
  function identCovers(A, B) {
    if (!A.length) return true;
    if (!B.length) return false;
    return B.every(function (b) { return A.indexOf(b) >= 0; });
  }
  function identOverlaps(A, B) {
    return !A.length || !B.length || A.some(function (a) { return B.indexOf(a) >= 0; });
  }
  function schedCovers(A, B) { return A.schedule === 'always' || A.schedule === B.schedule; }
  function schedOverlaps(A, B) { return A.schedule === 'always' || B.schedule === 'always' || A.schedule === B.schedule; }

  function prep(p, objs) {
    p.n = { src: atomsOf(p.srcaddr, objs), dst: atomsOf(p.dstaddr, objs), svc: svcSet(p.service, objs) };
  }
  function covers(A, B) {
    return !A.complex && !B.complex && ifCovers(A.srcintf, B.srcintf) && ifCovers(A.dstintf, B.dstintf) &&
      schedCovers(A, B) && identCovers(A.ident, B.ident) && svcCovers(A.n.svc, B.n.svc) &&
      setCovers(A.n.src, B.n.src) && setCovers(A.n.dst, B.n.dst);
  }
  function overlaps(A, B) {
    return !A.complex && !B.complex && ifOverlaps(A.srcintf, B.srcintf) && ifOverlaps(A.dstintf, B.dstintf) &&
      schedOverlaps(A, B) && identOverlaps(A.ident, B.ident) && svcOverlaps(A.n.svc, B.n.svc) &&
      setOverlaps(A.n.src, B.n.src) && setOverlaps(A.n.dst, B.n.dst);
  }

  // ----------------------------------------------------------------- analysis
  var DEFAULTS = {
    wan: 'wan|internet|isp|sdwan|virtual-wan-link',
    untrusted: 'guest|visitor|vendor|dmz',
    sensitive: 'data.?cent|server|core',
    staleDays: 90,
    vpnGroupLimit: 5,
  };
  var SEV = { high: 0, med: 1, low: 2, info: 3 };

  function analyse(input, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var now = opts.now || Date.now();
    var pols = policiesFrom(parseConfig(input.policies));
    if (!pols.length) throw new Error('No "config firewall policy" entries found. Paste the output of: show firewall policy');
    var objSections = parseConfig(input.objects);
    var objs = input.objects && input.objects.trim() ? indexObjects(objSections) : null;
    var hits = input.hits && input.hits.trim() ? parseHits(input.hits, now) : null;
    function re(s, d) { try { return new RegExp(s || d, 'i'); } catch (e) { return new RegExp(d, 'i'); } }
    var wanRe = re(opts.wan, DEFAULTS.wan), untrustedRe = re(opts.untrusted, DEFAULTS.untrusted),
      sensitiveRe = re(opts.sensitive, DEFAULTS.sensitive);
    function anyMatch(list, rx) { return list.some(function (n) { return rx.test(n); }); }
    function hasAny(list) { return list.indexOf('any') >= 0; }

    pols.forEach(function (p) { prep(p, objs); });
    var enabled = pols.filter(function (p) { return p.enabled; });
    var accepts = enabled.filter(function (p) { return p.action !== 'deny'; });
    var byId = {};
    pols.forEach(function (p) { byId[p.id] = p; });

    var findings = [], script = { disable: [], moves: [] };
    function add(code, sev, title, why, fix, items) {
      if (items && items.length) findings.push({ code: code, sev: sev, title: title, why: why, fix: fix, items: items });
    }
    function item(p, note) { return { id: p.id, name: p.name, note: note || '' }; }
    function evalList(list, fn) {
      var out = [];
      fn = fn || function () { return true; };
      list.forEach(function (p) { var n = fn(p); if (n) out.push(item(p, n === true ? '' : n)); });
      return out;
    }

    // --- allow-all / broad rules
    var allAll = accepts.filter(function (p) {
      return isAnyAddr(p.n.src) && isAnyAddr(p.n.dst) && p.n.svc.all;
    });
    add('ALLALL', 'high', 'Allow-everything rules (any source, any destination, ALL services)',
      'These rules permit any service from any address to any address. They are the first place an attacker or malware moves freely.',
      'Replace ALL with the services actually needed (HTTP/HTTPS/DNS for user egress), and scope the source to the real subnets. Rules tied to a user/group are lower risk; rules with no identity and "any" interfaces are the worst.',
      evalList(allAll, function (p) {
        var bad = hasAny(p.srcintf) || hasAny(p.dstintf) || anyMatch(p.srcintf, wanRe);
        return (bad ? 'HIGH: ' : '') + (p.ident.length ? 'identity-limited' : 'no user/group limit') +
          (hasAny(p.srcintf) || hasAny(p.dstintf) ? ', interface "any"' : '');
      }));
    // downgrade pure identity-limited, non-any rules to medium
    var fAll = findings[findings.length - 1];
    if (fAll && fAll.code === 'ALLALL') {
      var risky = fAll.items.filter(function (i) { return /^HIGH/.test(i.note); }).length;
      if (!risky) fAll.sev = 'med';
    }

    var allSvc = accepts.filter(function (p) {
      return p.n.svc.all && allAll.indexOf(p) < 0;
    });
    add('ALLSVC', 'low', 'Rules that allow ALL services',
      'Service ALL makes the rule a full pass for the matching hosts, even when addresses are narrow.',
      'Use the Log & Report > Forward Traffic view filtered by policy ID to see which services are really used, then list only those.',
      evalList(allSvc, function (p) { return isAnyAddr(p.n.src) ? 'source is "all"' : true; }));

    var equiv = accepts.filter(function (p) {
      var s = p.n.svc;
      return !s.all && s.tcp && s.udp && s.items.length;
    });
    add('SVCEQV', 'med', 'Service list is effectively ALL (ALL_TCP + ALL_UDP + extras)',
      'ALL_TCP and ALL_UDP already cover every port, so the extra services listed (SMTP, POP3, MS-SQL...) restrict nothing and give a false sense of control.',
      'Either delete the ALL_TCP/ALL_UDP entries and keep only the listed services, or switch to ALL and document it.',
      evalList(equiv, function (p) { return p.n.svc.items.length + ' extra services listed next to ALL_TCP/ALL_UDP'; }));

    add('INTFANY', 'med', 'Rules using interface "any"',
      '"any" includes WAN and VPN interfaces and any interface added later, so the rule silently widens over time.',
      'List the exact interfaces or a zone.',
      evalList(accepts.filter(function (p) { return hasAny(p.srcintf) || hasAny(p.dstintf); }),
        function (p) { return (hasAny(p.srcintf) ? 'srcintf any' : '') + (hasAny(p.srcintf) && hasAny(p.dstintf) ? ', ' : '') + (hasAny(p.dstintf) ? 'dstintf any' : ''); }));

    // --- internet-facing
    var inbound = accepts.filter(function (p) { return anyMatch(p.srcintf, wanRe); });
    add('INALL', 'high', 'Internet-facing rules allowing ALL services',
      'Traffic arriving from the WAN is allowed on every port to the published server.',
      'Restrict to the exact ports of the published service (e.g. 443, SIP 5060/5061 + RTP range). Test/temporary names here should be removed first.',
      evalList(inbound.filter(function (p) { return p.n.svc.all; }), function (p) { return isAnyAddr(p.n.src) ? 'source: any internet address' : 'limited source'; }));
    add('INNOUTM', 'med', 'Internet-facing rules without UTM profiles',
      'Inbound traffic to published servers should at least have IPS and AV.',
      'Enable IPS (and AV/web application controls where it fits) on every inbound rule.',
      evalList(inbound.filter(function (p) { return !p.hasUtm; })));
    add('INDEEP', 'low', 'Internet-facing rules without deep (full) SSL inspection',
      'With certificate-inspection only, IPS and AV cannot see inside HTTPS to your published servers.',
      'Use a deep-inspection profile with the server certificate imported (protecting-servers mode).',
      evalList(inbound.filter(function (p) { return p.hasUtm && (!p.ssl || /^(certificate|no)-inspection$/i.test(p.ssl)); }), function (p) { return 'ssl-ssh-profile: ' + (p.ssl || 'none'); }));
    add('INANY', 'low', 'Internet-facing rules open to any source address',
      'Anyone on the internet can reach the service.',
      'Add a geo-IP or trusted-source address object where the user base is known (partners, countries).',
      evalList(inbound.filter(function (p) { return isAnyAddr(p.n.src); })));

    // --- missing inspection / logging
    var egress = accepts.filter(function (p) { return anyMatch(p.dstintf, wanRe) || hasAny(p.dstintf); });
    add('NOUTM', 'med', 'Internet-bound rules with no security profiles at all',
      'No AV, IPS, web filter or application control is applied to this traffic.',
      'Attach at least AV + IPS + web filter. If these are deliberate exceptions (admin PCs), document the owner and review them quarterly.',
      evalList(egress.filter(function (p) { return !p.hasUtm; }), function (p) { return isAnyAddr(p.n.dst) ? 'to any destination' : true; }));
    add('NOUTMINT', 'low', 'Internal rules with ALL services and no security profiles',
      'East-west traffic is not inspected.',
      'Add IPS at minimum on rules between server, user and third-party segments.',
      evalList(accepts.filter(function (p) { return !p.hasUtm && p.n.svc.all && egress.indexOf(p) < 0 && inbound.indexOf(p) < 0; })));
    add('UTMGAP', 'low', 'Internet-bound rules missing AV or IPS',
      'UTM is on, but some profiles are missing.',
      'Add the missing profile, or confirm the omission is intentional.',
      evalList(egress.filter(function (p) { return p.hasUtm && (!p.profiles['av-profile'] || !p.profiles['ips-sensor']); }),
        function (p) { return 'missing ' + [!p.profiles['av-profile'] && 'AV', !p.profiles['ips-sensor'] && 'IPS'].filter(Boolean).join(' + '); }));
    add('IPSPASS', 'low', 'IPS sensor that looks like pass-through',
      'Sensor names containing "pass", "allow" or "none" usually mean IPS is effectively off for this rule.',
      'Confirm the sensor really blocks. If this was an exception for one server, narrow it.',
      evalList(enabled.filter(function (p) { return p.profiles['ips-sensor'] && /pass|allow|none|disable/i.test(p.profiles['ips-sensor']); }),
        function (p) { return 'ips-sensor: ' + p.profiles['ips-sensor']; }));
    add('NOLOG', 'med', 'Accept rules with logging disabled',
      'No traffic log means no forensics for this path.',
      'Set logtraffic all (or at least utm with profiles) on every accept rule.',
      evalList(accepts.filter(function (p) { return p.log === 'disable'; })));
    add('NOLOG2', 'low', 'Accept rules that only log security events, but have no security profiles',
      'logtraffic is the default (utm) and no profile is attached, so nothing is ever logged.',
      'Set logtraffic all.',
      evalList(accepts.filter(function (p) { return p.log === 'utm' && !p.hasUtm; })));

    // --- sensitive reach
    add('UNTRUST', 'high', 'Untrusted networks (guest/vendor/DMZ) reaching server networks',
      'Rules from segments matching the "untrusted" pattern into segments matching the "sensitive" pattern. Check the pattern fields at the top; add your third-party interface names there.',
      'Limit to the exact hosts and ports needed (e.g. DNS/DHCP only for guests); remove AD/SMB/RADIUS from untrusted segments.',
      evalList(accepts.filter(function (p) { return anyMatch(p.srcintf, untrustedRe) && anyMatch(p.dstintf, sensitiveRe); }),
        function (p) { return (p.n.svc.all ? 'ALL services' : p.service.length + ' services') + (isAnyAddr(p.n.src) ? ', source "all"' : ''); }));

    // --- VPN / identity
    var testRe = /test|temp|tmp|demo|trial/i;
    add('TESTGRP', 'med', 'Test/temporary users or groups in access rules',
      'A group or user with a test name is granting production access.',
      'Remove it from the rule, or rename and document it if it is really in use.',
      evalList(accepts.filter(function (p) { return p.ident.some(function (x) { return testRe.test(x); }); }),
        function (p) { return p.ident.filter(function (x) { return testRe.test(x); }).join(', '); }));
    add('VPNBROAD', 'med', 'VPN rules granting many groups wide access',
      'Many groups share one wide rule, so every group (including third-party vendors) gets the same reach.',
      'Split per vendor/team with only the hosts and services each needs.',
      evalList(accepts.filter(function (p) {
        return /ssl|vpn/i.test(p.srcintf.join(' ')) && p.ident.length >= opts.vpnGroupLimit && p.n.svc.all;
      }), function (p) { return p.ident.length + ' users/groups, ALL services'; }));
    add('USERPOL', 'low', 'Rules bound to individual users',
      'Per-person rules rot when people change roles and are hard to audit.',
      'Use a group, and keep the rule only while the need exists.',
      evalList(accepts.filter(function (p) { return p.users.length; }), function (p) { return 'users: ' + p.users.join(', '); }));
    var gcase = {};
    pols.forEach(function (p) { p.groups.concat(p.users).forEach(function (g) { (gcase[g.toLowerCase()] = gcase[g.toLowerCase()] || {})[g] = 1; }); });
    var dupG = Object.keys(gcase).filter(function (k) { return Object.keys(gcase[k]).length > 1; });
    add('GRPCASE', 'low', 'Groups that differ only by upper/lower case',
      'Two spellings of the same group name usually mean a duplicate group object.',
      'Keep one and update the policies.',
      dupG.map(function (k) { return { id: '-', name: '', note: Object.keys(gcase[k]).join(' / ') }; }));

    var macRe = /(^|[\s_-])mac([\s_-]|$)/i;
    add('MACSRC', 'low', 'Rules relying on MAC-address sources',
      'MAC addresses are easily spoofed on the same segment, so a MAC-based exception is only as strong as the L2 network.',
      'Prefer user/group (FSSO) or 802.1X device identity for exceptions.',
      evalList(accepts.filter(function (p) {
        return p.srcaddr.some(function (a) {
          var o = objs && objs.address[a];
          return o ? (o.type && o.type[0] === 'mac') : macRe.test(a);
        });
      })));
    add('NATINT', 'low', 'NAT enabled towards an internal interface',
      'Source NAT between internal networks hides the real client in logs.',
      'Disable NAT unless the destination cannot route back.',
      evalList(accepts.filter(function (p) { return p.nat && !anyMatch(p.dstintf, wanRe) && !hasAny(p.dstintf); })));

    // --- hygiene
    add('DISABLED', 'low', 'Disabled policies',
      'Disabled rules clutter the list and can be re-enabled by mistake.',
      'Delete after a config backup. Keep a copy of the CLI for each one in your change record.',
      evalList(pols.filter(function (p) { return !p.enabled; })));
    var hygRe = /test|tmp|temp|\bold\b|bak|delete|\bnew\b|temporary|trial/i;
    add('TESTNAME', 'low', 'Test / temporary / personal-looking policy names',
      'Names suggest a temporary or one-off exception that was never removed.',
      'Confirm the owner and need; rename to describe the purpose, or remove.',
      evalList(pols.filter(function (p) { return hygRe.test(p.name); })));
    add('NONAME', 'low', 'Policies without a name',
      'Unnamed policies are hard to audit.', 'Add a descriptive name.',
      evalList(pols.filter(function (p) { return !p.name; })));
    add('COPYCMT', 'low', 'Comments that only contain "(Copy of ...)" chains',
      'The comment records where the rule was cloned from, not why it exists.',
      'Replace with purpose, requester and ticket/date.',
      evalList(pols.filter(function (p) { return p.comments && !p.comments.replace(/\(copy of[^)]*\)/ig, '').replace(/\(reverse of[^)]*\)/ig, '').trim(); })));

    var last = pols[pols.length - 1];
    var finalDeny = last && last.action === 'deny' && last.enabled && last.n.src.some(function (a) { return a.any; }) &&
      last.n.dst.some(function (a) { return a.any; }) && last.n.svc.all;
    if (!finalDeny) {
      findings.push({
        code: 'NOFINAL', sev: 'info', title: 'No explicit final deny-all rule with logging',
        why: 'The implicit deny at the end of the policy list does not write logs by default, so blocked traffic is invisible.',
        fix: 'Add a last rule: srcintf any, dstintf any, all, all, ALL, action deny, logtraffic all (or enable "Log all denied traffic" in system settings).',
        items: [{ id: '-', name: '', note: '' }],
      });
    }

    // --- order problems: shadowing and bypassed deny rules
    var shadowed = [], redundant = [], bypass = [];
    enabled.forEach(function (B, bi) {
      for (var i = 0; i < bi; i++) {
        var A = enabled[i];
        if (A.pos > B.pos) break;
        if (!covers(A, B)) continue;
        var sameAction = (A.action === 'deny') === (B.action === 'deny');
        var lost = Object.keys(B.profiles).filter(function (k) { return !A.profiles[k]; });
        var mutual = covers(B, A);
        var note = 'fully covered by #' + A.id + (A.name ? ' (' + A.name + ')' : '') + (mutual ? ' - identical match' : '');
        if (!sameAction && A.action === 'deny') {
          shadowed.push(item(B, note + ': blocked by an earlier DENY, never matches'));
        } else if (!sameAction) {
          shadowed.push(item(B, note + ': earlier ACCEPT makes this DENY useless'));
        } else {
          redundant.push(item(B, note + (lost.length ? '; its ' + lost.map(function (k) { return k.replace(/-(profile|sensor)$/, ''); }).join(', ') + ' profile never applies' : '')));
          script.disable.push({ id: B.id, why: 'never matches (covered by #' + A.id + ')' });
        }
        return;
      }
    });
    add('SHADOWDENY', 'high', 'Deny rules made useless, or rules blocked by an earlier deny',
      'An earlier rule already matches all of this rule\'s traffic with the opposite action.',
      'Move the rule above the one that covers it (see script), or delete it.', shadowed);
    add('SHADOW', 'med', 'Rules that can never match (fully covered by an earlier rule with the same action)',
      'The earlier rule always wins, so this rule is dead weight, and any stricter profiles it carries (web filter, IPS) never apply.',
      'If the stricter profile is wanted, reorder; otherwise disable and delete.', redundant);

    var shadowedIds = {};
    shadowed.forEach(function (i) { shadowedIds[i.id] = 1; });
    enabled.forEach(function (B, bi) {
      if (B.action !== 'deny' || shadowedIds[B.id]) return;
      var hit = [];
      for (var i = 0; i < bi; i++) {
        var A = enabled[i];
        if (A.action === 'deny' || A.pos > B.pos) continue;
        if (overlaps(A, B)) hit.push(A);
      }
      if (hit.length) {
        bypass.push(item(B, 'earlier ACCEPT rules overlap it: ' + hit.slice(0, 8).map(function (a) { return '#' + a.id; }).join(', ') +
          (hit.length > 8 ? ' +' + (hit.length - 8) + ' more' : '') + ' - that traffic is allowed before this deny is reached'));
        script.moves.push({ id: B.id, before: hit[0].id, count: hit.length });
      }
    });
    add('DENYBYPASS', 'high', 'Block rules that earlier accept rules bypass',
      'First match wins. A deny placed below an accept that overlaps it only blocks the traffic nobody else already allowed.',
      'Move the deny above the first overlapping accept (script below). If the earlier rules are deliberate exceptions, keep them above and document them.',
      bypass);

    // --- hit counters
    var hitCover = 0;
    if (hits) {
      var unused = [], stale = [];
      pols.forEach(function (p) {
        var h = hits[p.id];
        if (!h) return;
        hitCover++;
        if (h.hits === 0 || h.ageDays === Infinity) {
          unused.push(item(p, p.enabled ? 'no hits' : 'no hits (already disabled)'));
          if (p.enabled) script.disable.push({ id: p.id, why: 'no hits' });
        } else if (h.ageDays != null && h.ageDays > opts.staleDays) {
          stale.push(item(p, 'last used ' + Math.round(h.ageDays) + ' days ago, ' + h.hits + ' hits total'));
          if (p.enabled) script.disable.push({ id: p.id, why: 'stale ' + Math.round(h.ageDays) + 'd' });
        }
      });
      add('UNUSED', 'med', 'Policies with zero hits',
        'Counters reset on reboot and on policy edit, so confirm uptime / the date counters were last cleared before deleting.',
        'Disable, wait one business cycle (month-end if applicable), then delete.', unused);
      add('STALE', 'low', 'Policies not used for more than ' + opts.staleDays + ' days', 'The rule has not matched traffic in a long time.',
        'Disable, then delete after a review period.', stale);
    }

    // --- object hygiene
    var objReport = null;
    if (objs) {
      var used = {}, usedSvc = {};
      function markAddr(n) {
        if (used[n]) return; used[n] = 1;
        var g = objs.addrgrp[n];
        if (g) (g.member || []).forEach(markAddr);
      }
      function markSvc(n) {
        if (usedSvc[n]) return; usedSvc[n] = 1;
        var g = objs.svcgrp[n];
        if (g) (g.member || []).forEach(markSvc);
      }
      pols.forEach(function (p) {
        p.srcaddr.concat(p.dstaddr).forEach(markAddr);
        p.service.forEach(markSvc);
      });
      var unrefAddr = Object.keys(objs.address).concat(Object.keys(objs.addrgrp)).filter(function (n) { return !used[n]; });
      var unrefSvc = Object.keys(objs.service).concat(Object.keys(objs.svcgrp)).filter(function (n) { return !usedSvc[n]; });
      // same-value duplicates
      var byVal = {};
      Object.keys(objs.address).forEach(function (n) {
        var o = objs.address[n], k = (o.type ? o.type[0] : 'ipmask') + '|' + [o.subnet, o['start-ip'], o['end-ip'], o.fqdn, o.country].map(function (x) { return x ? x.join(' ') : ''; }).join('|');
        (byVal[k] = byVal[k] || []).push(n);
      });
      var dupObj = Object.keys(byVal).filter(function (k) { return byVal[k].length > 1; });
      add('OBJUNREF', 'low', 'Address / service objects not used by any firewall policy',
        'Not referenced by any policy (directly or via a group a policy uses). They may still be used by routes, VIPs, IPsec, DoS policies or central NAT.',
        'Check "References" in the GUI for each before deleting.',
        unrefAddr.concat(unrefSvc).map(function (n) { return { id: '-', name: n, note: '' }; }));
      add('OBJDUP', 'low', 'Address objects with identical values',
        'Two names for the same thing means rules drift apart when one is edited.',
        'Keep one and repoint the policies.',
        dupObj.map(function (k) { return { id: '-', name: byVal[k].join(' = '), note: '' }; }));
      objReport = { unrefAddr: unrefAddr.length, unrefSvc: unrefSvc.length, dup: dupObj.length };
    }

    findings.sort(function (a, b) { return SEV[a.sev] - SEV[b.sev] || b.items.length - a.items.length; });

    // de-duplicate script entries
    var seen = {};
    script.disable = script.disable.filter(function (d) { if (seen[d.id]) return false; seen[d.id] = 1; return true; });
    var counts = { high: 0, med: 0, low: 0, info: 0 };
    findings.forEach(function (f) { counts[f.sev]++; });
    var multiVdom = parseConfig(input.policies).filter(function (s) { return s.path === 'firewall policy'; }).length > 1;

    return {
      policies: pols, findings: findings, script: buildScript(script), scriptParts: script,
      stats: {
        total: pols.length, enabled: enabled.length, disabled: pols.length - enabled.length,
        inbound: inbound.length, egress: egress.length, counts: counts, hitCover: hitCover,
        hasHits: !!hits, hasObjects: !!objs, objReport: objReport, multiVdom: multiVdom,
      },
      byId: byId,
    };
  }

  function buildScript(s) {
    var out = [];
    if (s.moves.length) {
      out.push('config firewall policy');
      s.moves.forEach(function (m) { out.push('    move ' + m.id + ' before ' + m.before); });
      out.push('end');
    }
    if (s.disable.length) {
      out.push('config firewall policy');
      s.disable.forEach(function (d) { out.push('    edit ' + d.id, '        set status disable', '    next'); });
      out.push('end');
    }
    return out.join('\n');
  }

  function toCsv(result) {
    var rows = [['Severity', 'Finding', 'Policy ID', 'Policy name', 'Detail', 'Recommended action']];
    result.findings.forEach(function (f) {
      f.items.forEach(function (i) { rows.push([f.sev, f.title, i.id, i.name || (i.id === '-' ? '' : (result.byId[i.id] || {}).name || ''), i.note, f.fix]); });
    });
    return rows.map(function (r) {
      return r.map(function (v) {
        var s = String(v == null ? '' : v);
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  return { analyse: analyse, parseConfig: parseConfig, parseHits: parseHits, toCsv: toCsv, DEFAULTS: DEFAULTS };
});
