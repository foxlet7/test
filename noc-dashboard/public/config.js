/*
 * NOC dashboard layout config - edit this file, no code changes needed.
 *
 * sections: rendered top-to-bottom in this order (think: traffic path,
 * Internet -> Firewall -> Core -> Access -> Servers).
 * A device goes into the FIRST section it matches:
 *   tags    - PRTG tags on the device (exact, case-insensitive)
 *   groups  - regex tested against the device's PRTG group name
 *   devices - regex tested against the device name
 *
 * Devices that match nothing go into a section named after their PRTG group
 * (unmatched: 'group') or into one "Other" section (unmatched: 'other').
 */
window.NOC_CONFIG = {
  title: 'NOC Dashboard',
  subtitle: 'PRTG live status',

  refreshSeconds: 30,       // how often the screen polls the backend
  staleAfterSeconds: 120,   // after this with no good update, screen goes "STALE"
  reloadPageHours: 6,       // full page reload every N hours (picks up a replaced file); 0 = never

  sections: [
    { title: 'WAN / Internet',        tags: ['noc-wan'],    groups: ['wan', 'internet', 'isp', 'circuit'] },
    { title: 'Firewalls',             tags: ['noc-fw'],     groups: ['firewall', 'fortigate', 'fgt'] },
    { title: 'Core',                  tags: ['noc-core'],   groups: ['core'] },
    { title: 'Distribution / Access', tags: ['noc-access'], groups: ['distribution', 'access', 'switch'] },
    { title: 'Servers',               tags: ['noc-server'], groups: ['server', 'domain', 'dc\\b'] },
    { title: 'Branches',              tags: ['noc-branch'], groups: ['branch', 'site'] },
  ],
  unmatched: 'group',

  excludeGroups: [],         // regex list, e.g. ['^Lab', 'Test']
  hidePausedDevices: false,  // hide devices that are fully paused
  sortDevices: 'name',       // 'name' keeps tiles in fixed positions; 'severity' floats problems to the front
  showHost: true,            // show device IP/hostname on tiles
  maxProblemsPerTile: 3,     // problem sensors listed inside each tile

  // ---- Show ONLY selected sensors/devices (like your old map) -------------
  // Put PRTG object IDs here (sensor IDs or device IDs - a device ID shows all
  // its sensors). Find an ID in the PRTG URL: .../sensor.htm?id=2045 -> 2045
  // Leave both empty to show everything the PRTG user can see.
  onlyIds: [],
  onlyTags: [],              // or: tag the sensors in PRTG (e.g. 'noc') and list the tag here
  showAllSensors: 'auto',    // list every selected sensor with its value ('auto' = when filtering)
  maxSensorsPerTile: 8,
  maxAlerts: 50,             // max rows in the alert panel
  alertStatuses: ['down', 'warn', 'unusual', 'ack'], // what counts as an alert in the right panel
};
