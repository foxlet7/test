package main

import (
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"
)

// SNMPCreds come from the device settings on the server.
type SNMPCreds struct {
	Version   string `json:"version"` // "2c" | "3"
	Community string `json:"community"`
	V3        *struct {
		User      string `json:"user"`
		AuthProto string `json:"authProto"`
		AuthPass  string `json:"authPass"`
		PrivProto string `json:"privProto"`
		PrivPass  string `json:"privPass"`
	} `json:"v3"`
}

const (
	oidIfName    = "1.3.6.1.2.1.31.1.1.1.1"
	oidIfDescr   = "1.3.6.1.2.1.2.2.1.2"
	oidIfOper    = "1.3.6.1.2.1.2.2.1.8"
	oidIfHCIn    = "1.3.6.1.2.1.31.1.1.1.6"
	oidIfHCOut   = "1.3.6.1.2.1.31.1.1.1.10"
	oidSysUpTime = "1.3.6.1.2.1.1.3.0"
	snmpTimeout  = 3 * time.Second
	snmpRetries  = 1
)

// snmpPort lets tests (and odd devices) use a non-standard port via config.port.
func connect(t Task) (*gosnmp.GoSNMP, error) {
	if t.SNMP == nil || t.SNMP.Version == "" {
		return nil, fmt.Errorf("SNMP is not configured on this device")
	}
	port := uint16(161)
	if p := cfgNum(t, "snmpPort", 0); p > 0 && p < 65536 {
		port = uint16(p)
	}
	g := &gosnmp.GoSNMP{Target: t.Host, Port: port, Timeout: snmpTimeout, Retries: snmpRetries, MaxOids: 60}
	switch t.SNMP.Version {
	case "2c":
		g.Version = gosnmp.Version2c
		g.Community = t.SNMP.Community
		if g.Community == "" {
			g.Community = "public"
		}
	case "3":
		v := t.SNMP.V3
		if v == nil || v.User == "" {
			return nil, fmt.Errorf("SNMPv3 user missing")
		}
		g.Version = gosnmp.Version3
		g.SecurityModel = gosnmp.UserSecurityModel
		usm := &gosnmp.UsmSecurityParameters{UserName: v.User}
		g.MsgFlags = gosnmp.NoAuthNoPriv
		if v.AuthProto != "" {
			g.MsgFlags = gosnmp.AuthNoPriv
			usm.AuthenticationPassphrase = v.AuthPass
			usm.AuthenticationProtocol = map[string]gosnmp.SnmpV3AuthProtocol{"MD5": gosnmp.MD5, "SHA": gosnmp.SHA, "SHA256": gosnmp.SHA256}[v.AuthProto]
			if v.PrivProto != "" {
				g.MsgFlags = gosnmp.AuthPriv
				usm.PrivacyPassphrase = v.PrivPass
				usm.PrivacyProtocol = map[string]gosnmp.SnmpV3PrivProtocol{"DES": gosnmp.DES, "AES": gosnmp.AES, "AES256": gosnmp.AES256}[v.PrivProto]
			}
		}
		g.SecurityParameters = usm
	default:
		return nil, fmt.Errorf("unknown SNMP version %q", t.SNMP.Version)
	}
	if c := cfgStr(t, "snmpContext"); c != "" { // SNMPv3 context (e.g. Cisco VRF / bridge contexts)
		g.ContextName = c
	}
	if err := g.Connect(); err != nil {
		return nil, err
	}
	return g, nil
}

func pduNumber(p gosnmp.SnmpPDU) (float64, bool) {
	switch p.Type {
	case gosnmp.NoSuchObject, gosnmp.NoSuchInstance, gosnmp.EndOfMibView, gosnmp.Null:
		return 0, false
	case gosnmp.OctetString:
		b, _ := p.Value.([]byte)
		f, err := strconv.ParseFloat(strings.TrimSpace(string(b)), 64)
		return f, err == nil
	}
	n := gosnmp.ToBigInt(p.Value)
	if n == nil {
		return 0, false
	}
	f, _ := new(big.Float).SetInt(n).Float64()
	return f, true
}

func snmpErr(err error) string {
	s := err.Error()
	if strings.Contains(s, "timeout") || strings.Contains(s, "Timeout") {
		return "SNMP timed out (check community / v3 credentials, ACL and UDP 161)"
	}
	return "SNMP: " + s
}

// ---------------------------------------------------------------- interface traffic

func resolveIfIndex(g *gosnmp.GoSNMP, t Task, st *State) (int, error) {
	if idx := int(cfgNum(t, "ifIndex", 0)); idx > 0 {
		return idx, nil
	}
	if v, ok := st.Get(t.ID, "ifIndex"); ok {
		return v.(int), nil
	}
	name := strings.ToLower(strings.TrimSpace(cfgStr(t, "ifName")))
	if name == "" {
		return 0, fmt.Errorf("no interface configured")
	}
	for _, base := range []string{oidIfName, oidIfDescr} {
		found := 0
		err := g.BulkWalk(base, func(p gosnmp.SnmpPDU) error {
			b, _ := p.Value.([]byte)
			if strings.ToLower(strings.TrimSpace(string(b))) == name {
				parts := strings.Split(p.Name, ".")
				found, _ = strconv.Atoi(parts[len(parts)-1])
			}
			return nil
		})
		if err != nil {
			return 0, err
		}
		if found > 0 {
			st.Set(t.ID, "ifIndex", found)
			return found, nil
		}
	}
	return 0, fmt.Errorf("interface %q not found (ifName / ifDescr)", cfgStr(t, "ifName"))
}

type counters struct {
	in, out float64
	at      time.Time
}

// rateMbps turns two octet-counter readings into Mbit/s. ok=false when the counters went
// backwards (device reboot or "clear counters"): no rate can be trusted for that interval.
func rateMbps(prev, cur counters) (inMbps, outMbps float64, ok bool) {
	secs := cur.at.Sub(prev.at).Seconds()
	if secs <= 0 || cur.in < prev.in || cur.out < prev.out {
		return 0, 0, false
	}
	return (cur.in - prev.in) * 8 / secs / 1e6, (cur.out - prev.out) * 8 / secs / 1e6, true
}

func checkSNMPTraffic(t Task, st *State) Result {
	g, err := connect(t)
	if err != nil {
		return fail(t, err.Error())
	}
	defer g.Conn.Close()
	idx, err := resolveIfIndex(g, t, st)
	if err != nil {
		if strings.Contains(err.Error(), "timeout") {
			return fail(t, snmpErr(err))
		}
		return fail(t, err.Error())
	}
	sfx := "." + strconv.Itoa(idx)
	res, err := g.Get([]string{oidIfHCIn + sfx, oidIfHCOut + sfx, oidIfOper + sfx})
	if err != nil {
		return fail(t, snmpErr(err))
	}
	in, ok1 := pduNumber(res.Variables[0])
	out, ok2 := pduNumber(res.Variables[1])
	oper, _ := pduNumber(res.Variables[2])
	if !ok1 || !ok2 {
		st.Forget(t.ID) // the index may have changed after a reboot: look it up again next time
		return fail(t, fmt.Sprintf("no 64-bit counters for ifIndex %d", idx))
	}
	now := time.Now()
	prev, had := st.Get(t.ID, "counters")
	st.Set(t.ID, "counters", counters{in, out, now})
	if oper != 1 {
		return Result{OK: false, Message: fmt.Sprintf("interface is down (ifOperStatus %v)", oper), Extra: map[string]any{"ifIndex": idx}}
	}
	if !had {
		return Result{OK: true, Message: "first sample: rate from the next check", Extra: map[string]any{"ifIndex": idx}}
	}
	inM, outM, ok := rateMbps(prev.(counters), counters{in, out, now})
	if !ok { // counter reset (reboot / clear counters)
		return Result{OK: true, Message: "counters reset: rate from the next check", Extra: map[string]any{"ifIndex": idx}}
	}
	return Result{OK: true, Value: val(inM + outM), Extra: map[string]any{
		"inMbps": math.Round(inM*1000) / 1000, "outMbps": math.Round(outM*1000) / 1000, "ifIndex": idx,
	}}
}

// ---------------------------------------------------------------- any OID

func checkSNMPOID(t Task) Result {
	oid := strings.TrimPrefix(cfgStr(t, "oid"), ".")
	if oid == "" {
		return fail(t, "no OID configured")
	}
	g, err := connect(t)
	if err != nil {
		return fail(t, err.Error())
	}
	defer g.Conn.Close()
	res, err := g.Get([]string{oid})
	if err != nil {
		return fail(t, snmpErr(err))
	}
	n, ok := pduNumber(res.Variables[0])
	if !ok {
		return fail(t, "OID "+oid+" returned no number (wrong OID or not supported by the device)")
	}
	return Result{OK: true, Value: val(n * cfgNum(t, "scale", 1))}
}

// ---------------------------------------------------------------- uptime / reboot detection

func checkSNMPUptime(t Task, st *State) Result {
	g, err := connect(t)
	if err != nil {
		return fail(t, err.Error())
	}
	defer g.Conn.Close()
	res, err := g.Get([]string{oidSysUpTime})
	if err != nil {
		return fail(t, snmpErr(err))
	}
	ticks, ok := pduNumber(res.Variables[0])
	if !ok {
		return fail(t, "sysUpTime not available")
	}
	hours := ticks / 100 / 3600
	r := Result{OK: true, Value: val(hours)}
	if prev, had := st.Get(t.ID, "uptime"); had && hours < prev.(float64) {
		r.Warn = true
		r.Message = fmt.Sprintf("device restarted (uptime now %.1f h)", hours)
	}
	st.Set(t.ID, "uptime", hours)
	return r
}
