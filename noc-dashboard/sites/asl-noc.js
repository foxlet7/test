/*
 * Layout matching PRTG map 3162 "Clone of Master NOC Dashboard".
 * IDs taken from the map's own object list (controls/maponly.htm?id=3162).
 * Items:  { id: 1234, label: '...' }    -> PRTG object ID (device or sensor) - most reliable
 *         { device: 'name' }            -> device by name (case/space-insensitive substring)
 *         { sensor: 'exact name' }      -> sensor by name (+ device: '...' to disambiguate)
 * Rows that don't resolve show as "not found" (wrong ID or the PRTG user can't see it).
 */
Object.assign(window.NOC_CONFIG, {
  title: 'AlasilaCX NOC',
  subtitle: 'PRTG live status',
  panels: [
    { title: 'Critical Systems', items: [
      { id: 42,   label: 'DNS/ADS: AD02' },
      { id: 2075, label: 'ADS: AD05' },
      { id: 2883, label: 'Genesys Cloud' },
      { id: 2961, label: 'FSSO-Collector-01' },
      { id: 3115, label: 'On-Prem FreeSwitch' },
    ] },
    { title: 'Critical Switches', items: [
      { id: 2333, label: 'AsilaCore1 [RMON]' },   // IP shows underneath
      { id: 2162, label: 'Main Switch (External Switch)' },
    ] },
    { title: 'AL-ULA', items: [
      { id: 2966, label: '(001) STC' },
      { id: 2971, label: '(002) Mobily' },
      { id: 2970, label: '(019) AsillahHQ' },
      { id: 2972, label: '(020) AlasilaHQ-2' },
    ] },
    { title: 'HQ Links', items: [
      { id: 2877, label: '(054) STC-120MB-DIA-12128' },
      { id: 3118, label: '(017) Main200' },
      { id: 3145, label: '(016) STCS-100' },
      { id: 2844, label: '(058) Alibaba' },
      { id: 2927, label: '(065) ALULA-office-2' },
      { id: 2879, label: '(059) Alula Office' },
      // Firewall policy 118 (SNMP Custom Advanced sensor). Matched by name until it has an ID:
      // any sensor with "Badael" in its name on the FortiGate-121G HQ.
      { sensor: '/Badael/', device: '121G', label: 'Badael-WAN (policy 118)' },
    ] },
    { title: 'Laban Links', items: [
      { id: 3158, label: '(002) STC' },
      { id: 3157, label: '(001) GO-Dawiyat' },
      { id: 3159, label: '(020) LBN-KSU' },
      { id: 3160, label: '(021) Zain-Corp' },
    ] },
  ],
});
