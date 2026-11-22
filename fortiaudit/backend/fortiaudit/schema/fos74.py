"""FortiOS 7.4 knowledge module (baseline target: 7.4.12 build 2902, FortiGate 121G).

PROVENANCE: authored from engineering knowledge of FortiOS 7.4 CLI. It was NOT
machine-extracted from the 7.4.12 CLI reference. Every default below carries
verified=False until reconciled against
https://docs.fortinet.com/document/fortigate/7.4.12/cli-reference/84566/fortios-cli-reference
Analyzers must treat defaults as "documented default, verify" and avoid
raising confirmed findings that depend solely on an unverified default.
"""

VERSION = "7.4"
TARGET = {"version": "7.4.12", "build": "2902", "model": "121G"}
VERIFIED = False

# namespace -> tables providing names in that namespace (order = resolution priority)
NAMESPACES = {
    "interface": ["system interface", "system zone", "system sdwan > zone", "vpn ipsec phase1-interface",
                  "system switch-interface"],
    "address": ["firewall address", "firewall addrgrp", "firewall vip", "firewall vipgrp",
                "firewall internet-service-custom"],
    "address6": ["firewall address6", "firewall addrgrp6", "firewall vip6", "firewall vipgrp6"],
    "service": ["firewall service custom", "firewall service group"],
    "schedule": ["firewall schedule recurring", "firewall schedule onetime", "firewall schedule group"],
    "ippool": ["firewall ippool"],
    "ippool6": ["firewall ippool6"],
    "usergroup": ["user group"],
    "user": ["user local"],
    "av-profile": ["antivirus profile"],
    "webfilter-profile": ["webfilter profile"],
    "application-list": ["application list"],
    "ips-sensor": ["ips sensor"],
    "dnsfilter-profile": ["dnsfilter profile"],
    "file-filter-profile": ["file-filter profile"],
    "dlp-profile": ["dlp profile"],
    "emailfilter-profile": ["emailfilter profile"],
    "voip-profile": ["voip profile"],
    "waf-profile": ["waf profile"],
    "ssl-ssh-profile": ["firewall ssl-ssh-profile"],
    "profile-group": ["firewall profile-group"],
    "phase1": ["vpn ipsec phase1-interface"],
    "certificate": ["vpn certificate local", "vpn certificate ca", "vpn certificate remote"],
    "accprofile": ["system accprofile"],
    "prefix-list": ["router prefix-list"],
    "access-list": ["router access-list"],
    "route-map": ["router route-map"],
    "health-check": ["system sdwan > health-check"],
}

# Objects that exist implicitly in FortiOS even if not printed in a backup.
PREDEFINED = {
    "interface": {"any", "virtual-wan-link", "ssl.root", "sdwan"},
    "address": {"all", "none"},
    "address6": {"all", "none"},
    "schedule": {"always", "none"},
    "av-profile": {"default", "wifi-default", "sniffer-profile"},
    "webfilter-profile": {"default", "wifi-default", "monitor-all", "sniffer-profile"},
    "application-list": {"default", "wifi-default", "block-high-risk", "sniffer-profile"},
    "ips-sensor": {"default", "all_default", "all_default_pass", "high_security", "protect_client",
                   "protect_email_server", "protect_http_server", "wifi-default", "sniffer-profile"},
    "dnsfilter-profile": {"default", "wifi-default"},
    "file-filter-profile": {"default", "sniffer-profile"},
    "ssl-ssh-profile": {"certificate-inspection", "deep-inspection", "no-inspection", "custom-deep-inspection"},
    "emailfilter-profile": {"default", "sniffer-profile"},
    "voip-profile": {"default", "strict"},
    "accprofile": {"super_admin", "prof_admin"},
    "certificate": {"Fortinet_Factory", "Fortinet_SSL", "Fortinet_CA_SSL", "Fortinet_CA_Untrusted",
                    "Fortinet_SSL_RSA2048", "Fortinet_SSL_ECDSA256", "Fortinet_SSL_ED25519"},
}

# Predefined services: name -> list of (proto, lo, hi). proto in tcp/udp/sctp/icmp/ip
# Port numbers are well-known IANA assignments matching FortiOS predefined services.
PREDEFINED_SERVICES = {
    "ALL": "ALL",
    "ALL_TCP": [("tcp", 1, 65535)], "ALL_UDP": [("udp", 1, 65535)],
    "ALL_ICMP": [("icmp", 0, 255)], "ALL_ICMP6": [("icmp6", 0, 255)],
    "HTTP": [("tcp", 80, 80)], "HTTPS": [("tcp", 443, 443)], "SSH": [("tcp", 22, 22)],
    "TELNET": [("tcp", 23, 23)], "FTP": [("tcp", 21, 21)], "SMTP": [("tcp", 25, 25)],
    "SMTPS": [("tcp", 465, 465)], "DNS": [("tcp", 53, 53), ("udp", 53, 53)],
    "NTP": [("tcp", 123, 123), ("udp", 123, 123)], "PING": [("icmp", 8, 8)],
    "POP3": [("tcp", 110, 110)], "POP3S": [("tcp", 995, 995)], "IMAP": [("tcp", 143, 143)],
    "IMAPS": [("tcp", 993, 993)], "SNMP": [("tcp", 161, 162), ("udp", 161, 162)],
    "SYSLOG": [("udp", 514, 514)], "TFTP": [("udp", 69, 69)], "DHCP": [("udp", 67, 68)],
    "LDAP": [("tcp", 389, 389)], "LDAP_UDP": [("udp", 389, 389)], "RDP": [("tcp", 3389, 3389)],
    "SMB": [("tcp", 445, 445)], "SAMBA": [("tcp", 139, 139)], "MYSQL": [("tcp", 3306, 3306)],
    "MS-SQL": [("tcp", 1433, 1434)], "BGP": [("tcp", 179, 179)], "OSPF": [("ip", 89, 89)],
    "RIP": [("udp", 520, 520)], "GRE": [("ip", 47, 47)], "ESP": [("ip", 50, 50)], "AH": [("ip", 51, 51)],
    "IKE": [("udp", 500, 500), ("udp", 4500, 4500)], "PPTP": [("tcp", 1723, 1723)],
    "L2TP": [("tcp", 1701, 1701), ("udp", 1701, 1701)], "VNC": [("tcp", 5900, 5900)],
    "KERBEROS": [("tcp", 88, 88), ("udp", 88, 88)], "SIP": [("udp", 5060, 5060)],
    "IRC": [("tcp", 6660, 6669)], "NNTP": [("tcp", 119, 119)], "RADIUS": [("udp", 1812, 1813)],
}

# table -> attr -> namespace ; "list" means multi-valued
REFS = {
    "firewall policy": {"srcintf": "interface", "dstintf": "interface", "srcaddr": "address", "dstaddr": "address",
                        "srcaddr6": "address6", "dstaddr6": "address6",
                        "service": "service", "schedule": "schedule", "poolname": "ippool", "poolname6": "ippool6",
                        "groups": "usergroup", "users": "user", "av-profile": "av-profile",
                        "webfilter-profile": "webfilter-profile", "application-list": "application-list",
                        "ips-sensor": "ips-sensor", "dnsfilter-profile": "dnsfilter-profile",
                        "file-filter-profile": "file-filter-profile", "dlp-profile": "dlp-profile",
                        "emailfilter-profile": "emailfilter-profile", "voip-profile": "voip-profile",
                        "waf-profile": "waf-profile", "ssl-ssh-profile": "ssl-ssh-profile",
                        "profile-group": "profile-group"},
    "firewall policy6": {"srcintf": "interface", "dstintf": "interface", "srcaddr": "address6", "dstaddr": "address6",
                         "service": "service", "schedule": "schedule", "poolname": "ippool6"},
    "firewall local-in-policy": {"intf": "interface", "srcaddr": "address", "dstaddr": "address",
                                 "service": "service", "schedule": "schedule"},
    "firewall DoS-policy": {"interface": "interface", "srcaddr": "address", "dstaddr": "address", "service": "service"},
    "firewall central-snat-map": {"srcintf": "interface", "dstintf": "interface", "orig-addr": "address",
                                  "dst-addr": "address", "nat-ippool": "ippool"},
    "firewall addrgrp": {"member": "address", "exclude-member": "address"},
    "firewall addrgrp6": {"member": "address6"},
    "firewall address": {"associated-interface": "interface"},
    "firewall address6": {},
    "firewall vip": {"extintf": "interface", "srcintf-filter": "interface"},
    "firewall vipgrp": {"interface": "interface", "member": "address"},
    "firewall service group": {"member": "service"},
    "firewall schedule group": {"member": "schedule"},
    "firewall profile-group": {"av-profile": "av-profile", "webfilter-profile": "webfilter-profile",
                               "application-list": "application-list", "ips-sensor": "ips-sensor",
                               "dnsfilter-profile": "dnsfilter-profile", "ssl-ssh-profile": "ssl-ssh-profile",
                               "file-filter-profile": "file-filter-profile"},
    "system interface": {"interface": "interface", "member": "interface"},
    "system zone": {"interface": "interface"},
    "system switch-interface": {"member": "interface"},
    "system sdwan > members": {"interface": "interface", "zone": "interface"},
    "system sdwan > health-check": {"members": None},
    "system sdwan > service": {"dst": "address", "src": "address", "priority-zone": "interface"},
    "router static": {"device": "interface", "dstaddr": "address", "sdwan-zone": "interface"},
    "router static6": {"device": "interface"},
    "router policy": {"input-device": "interface", "output-device": "interface", "srcaddr": "address",
                      "dstaddr": "address"},
    "router bgp > neighbor": {"route-map-in": "route-map", "route-map-out": "route-map",
                              "prefix-list-in": "prefix-list", "prefix-list-out": "prefix-list"},
    "router ospf > ospf-interface": {"interface": "interface"},
    "router route-map > rule": {"match-ip-address": "access-list", "match-ip-nexthop": "access-list"},
    "vpn ipsec phase1-interface": {"interface": "interface", "certificate": "certificate", "usrgrp": "usergroup"},
    "vpn ipsec phase2-interface": {"phase1name": "phase1", "src-name": "address", "dst-name": "address"},
    "system dhcp server": {"interface": "interface"},
    "system admin": {"accprofile": "accprofile"},
    "system ha": {"hbdev": "interface", "monitor": "interface", "ha-mgmt-interfaces > interface": "interface"},
    "system ha > ha-mgmt-interfaces": {"interface": "interface"},
    "system global": {"admin-server-cert": "certificate"},
    "user group": {"member": None},
    "system virtual-wire-pair": {"member": "interface"},
}

# Attributes whose values alternate name/number (e.g. `set hbdev "port1" 50 "port2" 50`)
PAIRED_REFS = {("system ha", "hbdev")}

DEFAULTS = {
    "firewall policy": {"status": "enable", "action": "deny", "nat": "disable", "logtraffic": "utm",
                        "srcaddr-negate": "disable", "dstaddr-negate": "disable", "service-negate": "disable",
                        "inspection-mode": "flow", "internet-service": "disable", "internet-service-src": "disable",
                        "ippool": "disable", "utm-status": "disable"},
    "system interface": {"status": "up", "mode": "static", "type": "physical", "mtu-override": "disable",
                         "mtu": "1500", "role": "undefined", "vdom": "root", "ip": "0.0.0.0 0.0.0.0"},
    "system zone": {"intrazone": "deny"},
    "firewall address": {"type": "ipmask", "subnet": "0.0.0.0 0.0.0.0"},
    "firewall vip": {"type": "static-nat", "portforward": "disable", "protocol": "tcp", "extintf": "any"},
    "router static": {"status": "enable", "distance": "10", "priority": "1", "weight": "0", "blackhole": "disable",
                      "dst": "0.0.0.0 0.0.0.0", "gateway": "0.0.0.0", "dynamic-gateway": "disable"},
    "router policy": {"status": "enable", "action": "permit"},
    "vpn ipsec phase1-interface": {"ike-version": "1", "mode": "main", "type": "static", "add-route": "enable",
                                   "nattraversal": "enable", "dpd": "on-demand", "authmethod": "psk"},
    "vpn ipsec phase2-interface": {"pfs": "enable", "replay": "enable", "auto-negotiate": "disable",
                                   "src-subnet": "0.0.0.0 0.0.0.0", "dst-subnet": "0.0.0.0 0.0.0.0",
                                   "src-addr-type": "subnet", "dst-addr-type": "subnet"},
    "system ha": {"mode": "standalone", "override": "disable", "priority": "128", "session-pickup": "disable"},
    "system settings": {"central-nat": "disable", "opmode": "nat"},
    "system dhcp server": {"status": "enable"},
    "system admin": {},
}

# Attributes whose values must never be displayed (redaction)
SENSITIVE_ATTRS = {
    "password", "passwd", "psksecret", "psksecret-remote", "private-key", "secret", "key", "auth-pwd", "priv-pwd",
    "community", "md5-key", "auth-password", "ppk-secret", "password2", "sso-password", "server-key",
    "authentication-key", "auth-key", "shared-secret", "secondary-secret", "tertiary-secret", "token",
    "psk", "pre-shared-key", "certificate", "csr", "passphrase", "ldap-password", "client-key",
}
# For `certificate` the attribute in `vpn certificate local` holds PEM; in phase1 it is a name.
SENSITIVE_TABLE_ATTRS = {("vpn certificate local", "certificate"), ("vpn certificate local", "private-key"),
                         ("vpn certificate ca", "ca"), ("vpn certificate remote", "remote")}
NON_SENSITIVE_OVERRIDE = {("vpn ipsec phase1-interface", "certificate"), ("system global", "admin-server-cert")}

# Tables the analyzers actually interpret. Anything else is parsed + preserved but "unanalysed".
ANALYZED_TABLES = {
    "system global", "system interface", "system zone", "system admin", "system accprofile", "system dns",
    "system ntp", "system ha", "system settings", "system snmp community", "system snmp user", "system dhcp server",
    "system sdwan", "system automation-stitch", "system csf", "system switch-interface", "log syslogd setting",
    "log fortianalyzer setting", "system fortiguard",
    "firewall policy", "firewall policy6", "firewall address", "firewall address6", "firewall addrgrp",
    "firewall addrgrp6", "firewall vip", "firewall vipgrp", "firewall ippool", "firewall service custom",
    "firewall service group", "firewall schedule recurring", "firewall schedule onetime", "firewall schedule group",
    "firewall local-in-policy", "firewall DoS-policy", "firewall central-snat-map", "firewall ssl-ssh-profile",
    "firewall profile-group",
    "router static", "router static6", "router policy", "router bgp", "router ospf", "router rip",
    "router prefix-list", "router access-list", "router route-map",
    "vpn ipsec phase1-interface", "vpn ipsec phase2-interface", "vpn certificate local", "vpn certificate ca",
    "antivirus profile", "webfilter profile", "application list", "ips sensor", "dnsfilter profile",
    "file-filter profile", "dlp profile", "user group", "user local",
}

WEAK_ENC = {"des", "3des", "null"}
WEAK_HASH = {"md5", "sha1"}
WEAK_DH = {"1", "2", "5", "14"}  # 14 (2048-bit MODP) acceptable but below current guidance; reported low
INSECURE_ADMIN_ACCESS = {"http", "telnet"}
