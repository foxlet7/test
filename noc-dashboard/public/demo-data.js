/*
 * Sample data for /?demo=1 - lets you review the layout without PRTG.
 * Names and IPs are fictional (RFC1918 / RFC5737). Not used in live mode.
 */
window.NOC_DEMO = function () {
  var id = 1000;
  var devices = [];
  var sensors = [];
  var tick = Math.floor(Date.now() / 30000); // changes a little every 30s

  function dev(group, name, host, list) {
    var d = { id: ++id, name: name, group: group, host: host, status: 3, tags: [], priority: 3 };
    var worst = 3;
    var rank = { 5: 0, 14: 0, 4: 1, 10: 2, 13: 3, 1: 4, 7: 5, 3: 6 };
    list.forEach(function (s) {
      var st = s[1] || 3;
      sensors.push({
        id: ++id, deviceId: d.id, device: name, group: group, name: s[0], status: st,
        message: s[2] || 'OK', lastValue: s[3] || '', priority: s[4] || 3, tags: [], downSince: s[5] || '',
      });
      if (rank[st] < rank[worst]) worst = st;
    });
    d.status = worst === 5 && list.some(function (s) { return (s[1] || 3) === 3; }) ? 14 : worst;
    devices.push(d);
  }

  var cpu = 70 + (tick % 5) * 5;

  dev('WAN Circuits', 'ISP-1 Primary (Fiber)', '203.0.113.1', [
    ['Ping', 3, 'OK', '4 msec'], ['Traffic wan1', 3, 'OK', '412 Mbit/s'], ['SLA Jitter', 3, 'OK', '1 msec']]);
  dev('WAN Circuits', 'ISP-2 Backup (LTE)', '198.51.100.1', [
    ['Ping', 3, 'OK', '38 msec'], ['Traffic wan2', 10, 'Unusual traffic for this time of day', '96 Mbit/s']]);
  dev('WAN Circuits', 'IPVPN - Jeddah', '10.255.0.2', [['Ping', 3, 'OK', '11 msec']]);

  dev('Firewalls', 'FGT-HQ-01 (Primary)', '10.0.0.1', [
    ['Ping', 3, 'OK', '1 msec'], ['HA Status', 3, 'OK', 'Primary'],
    ['CPU Load', cpu >= 85 ? 4 : 3, cpu >= 85 ? 'Warning: above 85 % limit' : 'OK', cpu + ' %'],
    ['Memory', 3, 'OK', '54 %'], ['IPsec Tunnels', 3, 'OK', '12 up']]);
  dev('Firewalls', 'FGT-HQ-02 (Secondary)', '10.0.0.2', [
    ['Ping', 3, 'OK', '1 msec'], ['HA Status', 3, 'OK', 'Secondary'], ['CPU Load', 3, 'OK', '6 %']]);

  dev('Core Switches', 'CORE-SW-01', '10.0.1.1', [
    ['Ping', 3, 'OK', '1 msec'], ['Po1 Uplink FGT', 3, 'OK', '380 Mbit/s'], ['CPU', 3, 'OK', '12 %']]);
  dev('Core Switches', 'CORE-SW-02', '10.0.1.2', [
    ['Ping', 3, 'OK', '1 msec'], ['Po1 Uplink FGT', 3, 'OK', '0 Mbit/s'], ['CPU', 3, 'OK', '9 %']]);

  ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'].forEach(function (f, i) {
    var list = [['Ping', 3, 'OK', '1 msec'], ['Uplink Te1/1/1', 3, 'OK', (40 + i * 13) + ' Mbit/s']];
    if (f === 'F3') list = [['Ping', 7, 'Paused by user: cabling works', ''], ['Uplink Te1/1/1', 7, 'Paused', '']];
    if (f === 'F5') list.push(['Uplink Te1/1/2', 4, 'Warning: CRC errors 1,204/min', '1.2k err/min']);
    dev('Access Switches', 'ACC-SW-' + f, '10.0.2.' + (11 + i), list);
  });

  dev('Servers', 'SRV-DC01', '10.0.10.10', [
    ['Ping', 3, 'OK', '0 msec'], ['DNS', 3, 'OK', '2 msec'], ['Disk C:', 3, 'OK', '41 % free']]);
  dev('Servers', 'SRV-DC02', '10.0.10.11', [
    ['Ping', 3, 'OK', '0 msec'], ['DNS', 3, 'OK', '3 msec'], ['Disk C:', 4, 'Warning: free space below 10 %', '8 % free']]);
  dev('Servers', 'SRV-FILE01', '10.0.10.20', [
    ['Ping', 3, 'OK', '0 msec'], ['Disk D:', 3, 'OK', '33 % free'], ['SMB 445', 3, 'OK', '4 msec']]);
  dev('Servers', 'SRV-BACKUP01', '10.0.10.30', [
    ['Ping', 3, 'OK', '0 msec'], ['Veeam Job Status', 13, 'Down (acknowledged): job failed, ticket INC-1042', '', 4, '3 h 12 m']]);

  dev('Branches', 'BR-Riyadh-North', '10.20.0.1', [['Ping', 3, 'OK', '9 msec'], ['IPsec to HQ', 3, 'OK', 'up']]);
  dev('Branches', 'BR-Dammam', '10.21.0.1', [
    ['Ping', 5, 'Request timed out (ICMP error # 11010)', '', 5, (12 + (tick % 10)) + ' m'],
    ['IPsec to HQ', 5, 'Tunnel down: phase 2 not established', '', 5, (12 + (tick % 10)) + ' m']]);
  dev('Branches', 'BR-Jeddah', '10.22.0.1', [['Ping', 3, 'OK', '14 msec'], ['IPsec to HQ', 3, 'OK', 'up']]);

  return { ok: true, fetchedAt: new Date().toISOString(), prtgVersion: 'demo', devices: devices, sensors: sensors };
};
