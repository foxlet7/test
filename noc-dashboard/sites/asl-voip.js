/*
 * AlasilaCX VoIP dashboard. Built from what is known of the PRTG tree:
 *   - Main Switch (External Switch)  device 2162  -> SIP circuits land here
 *   - On-Prem FreeSwitch             device 3115
 *   - Genesys Cloud                  device 2883
 *   - (058) Alibaba Traffic          sensor 2844 on the HQ FortiGate
 *   - PRTG tag "sbc"                 -> everything tagged SBC (incl. inherited tags)
 * Name patterns (/.../) catch the rest; replace them with { id: ... } once known.
 * expand: true = one row per sensor of that device.
 * optional: true = no "not found" row when a catch-all pattern matches nothing.
 */
// Registers this layout as a view; build several site files into one page for a NOC/VoIP toggle.
(window.NOC_PRESETS = window.NOC_PRESETS || []).push({
  key: 'voip',
  label: 'VoIP',
  title: 'AlasilaCX VoIP',
  subtitle: 'SIP, SBC, FreeSWITCH & cloud voice',
  scope: 'panels',   // counts + alerts only for VoIP items, not the whole PRTG
  panels: [
    { title: 'SIP Circuits', items: [   // on the External Switch
      { id: 2162, expand: true },
      { sensor: '/\\b(sip|trunk|voice)\\b.*traffic/', optional: true },   // trunk ports on any device
    ] },
    { title: 'SBC', items: [
      { tag: 'sbc' },
      { device: '/\\bsbc\\b|session border/', expand: true, optional: true },
    ] },
    { title: 'FreeSWITCH', items: [
      { id: 3115, expand: true },
      { device: '/freeswitch|fusionpbx/', expand: true, optional: true },
    ] },
    { title: 'Alibaba Cloud', items: [
      { id: 2844, label: '(058) Alibaba · HQ FortiGate' },
      { sensor: '/alibaba|aliyun/', optional: true },               // IPsec tunnel sensors etc.
      { device: '/alibaba|aliyun/', expand: true, optional: true },
    ] },
    { title: 'Contact Center', items: [
      { id: 2883, expand: true },
    ] },
  ],
});
