/*
 * Management report profile - the "Covering" list in the report gets
 * "Monthly management report". Groups are independent of the dashboard boxes.
 * Items use the same rules as the dashboard ({ id }, { sensor }, { device }, optional, any).
 * IDs are PRTG object IDs (taken from the NOC layout in asl-noc.js).
 */
(window.NOC_REPORT_PROFILES = window.NOC_REPORT_PROFILES || []).push({
  key: 'monthly',
  label: 'Monthly management report',
  title: 'Network Availability Report',
  groups: [
    { title: 'HQ Internet & WAN', items: [
      { id: 2877, label: '(054) STC 120 Mb DIA' },
      { id: 3118, label: '(017) Main200' },
      { id: 3145, label: '(016) STCS-100' },
      { id: 2843, label: 'Badael-WAN (policy 118)' },
    ] },
    { title: 'Key tunnels & cloud', items: [
      { id: 2844, label: '(058) Alibaba Cloud' },
      { id: 3160, label: '(021) Zain-Corp' },
      // extra tunnel sensors, if they exist in PRTG (e.g. FortiGate IPsec sensors)
      { sensor: '/alibaba|aliyun/', optional: true },
      { sensor: '/zain.*(tunnel|ipsec|vpn)|(tunnel|ipsec|vpn).*zain/', optional: true },
    ] },
    { title: 'Laban site', items: [
      { id: 3158, label: '(002) STC' },
      { id: 3157, label: '(001) GO-Dawiyat' },
      { id: 3159, label: '(020) LBN-KSU' },
      { id: 3160, label: '(021) Zain-Corp' },
      { id: 3184, label: 'LBN-STC-RT (gateway ping)' },
      { id: 3186, label: 'LBN-GO-RT (gateway ping)' },
      { id: 3152, label: 'LBN-Tamam-STC-RT (gateway ping)' },
    ] },
    { title: 'AL-ULA site', items: [
      { id: 2966, label: '(001) STC' },
      { id: 2971, label: '(002) Mobily' },
      { id: 2970, label: '(019) AsillahHQ' },
      { id: 2972, label: '(020) AlasilaHQ-2' },
    ] },
    { title: 'Inter-site links', items: [
      { id: 2927, label: '(065) ALULA-office-2' },
      { id: 2879, label: '(059) Alula Office' },
    ] },
    { title: 'Critical systems', items: [
      { id: 42,   label: 'DNS/ADS: AD02' },
      { id: 2075, label: 'ADS: AD05' },
      { id: 2883, label: 'Genesys Cloud' },
      { id: 2961, label: 'FSSO-Collector-01' },
      { id: 3115, label: 'On-Prem FreeSwitch' },
    ] },
    { title: 'Core network', items: [
      { id: 2333, label: 'AsilaCore1' },
      { id: 2162, label: 'Main Switch (External Switch)' },
    ] },
  ],
});
