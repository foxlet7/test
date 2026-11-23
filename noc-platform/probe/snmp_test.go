package main

import (
	"math"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRateMbps(t *testing.T) {
	t0 := time.Unix(0, 0)
	// 75,000,000 octets in 60 s = 10 Mbit/s; 15,000,000 = 2 Mbit/s
	in, out, ok := rateMbps(counters{1e9, 5e8, t0}, counters{1e9 + 75e6, 5e8 + 15e6, t0.Add(time.Minute)})
	if !ok || math.Abs(in-10) > 1e-9 || math.Abs(out-2) > 1e-9 {
		t.Fatalf("in=%v out=%v ok=%v", in, out, ok)
	}
	if _, _, ok := rateMbps(counters{1e9, 5e8, t0}, counters{1e6, 5e8, t0.Add(time.Minute)}); ok {
		t.Fatal("counter reset must not produce a rate")
	}
	if _, _, ok := rateMbps(counters{1, 1, t0}, counters{2, 2, t0}); ok {
		t.Fatal("zero interval must not produce a rate")
	}
}

// Integration test against a real SNMP agent. Run with e.g.
//
//	NOC_SNMP_TEST=127.0.0.1:1161 go test -run SNMP ./...
//
// (CI uses snmpsim serving a FortiGate-like interface table: wan1 = ifIndex 3,
// counters rising 10 Mbit/s in and 2 Mbit/s out.)
func snmpTarget(t *testing.T) (string, float64) {
	addr := os.Getenv("NOC_SNMP_TEST")
	if addr == "" {
		t.Skip("set NOC_SNMP_TEST=host:port to run SNMP integration tests")
	}
	host, port, _ := strings.Cut(addr, ":")
	p := 161.0
	if port != "" {
		p = cfgNum(Task{Config: map[string]any{"p": port}}, "p", 161)
	}
	return host, p
}

func TestSNMPv2cTrafficByInterfaceName(t *testing.T) {
	host, port := snmpTarget(t)
	tk := Task{ID: "t", Type: "SNMP_TRAFFIC", Host: host, SNMP: &SNMPCreds{Version: "2c", Community: "public"},
		Config: map[string]any{"ifName": "WAN1", "snmpPort": port}}
	st := NewState()
	first := Check(t.Context(), tk, st)
	if !first.OK || first.Value != nil || first.Extra["ifIndex"] != 3 {
		t.Fatalf("first sample should resolve wan1 -> ifIndex 3 and report no rate yet: %+v", first)
	}
	time.Sleep(3 * time.Second)
	r := Check(t.Context(), tk, st)
	if !r.OK || r.Value == nil {
		t.Fatalf("%+v", r)
	}
	// The simulator's absolute rate depends on its own timing model; what must hold is the
	// configured 5:1 in/out ratio and value = in + out. Exact arithmetic: TestRateMbps.
	in, out := r.Extra["inMbps"].(float64), r.Extra["outMbps"].(float64)
	if in <= 0 || math.Abs(in/out-5) > 0.2 || math.Abs(*r.Value-(in+out)) > 0.01 {
		t.Fatalf("in=%.3f out=%.3f value=%.3f", in, out, *r.Value)
	}
}

func TestSNMPv2cOIDAndUptime(t *testing.T) {
	host, port := snmpTarget(t)
	creds := &SNMPCreds{Version: "2c", Community: "public"}
	r := Check(t.Context(), Task{ID: "o", Type: "SNMP_OID", Host: host, SNMP: creds,
		Config: map[string]any{"oid": ".1.3.6.1.4.1.12356.101.4.1.3.0", "snmpPort": port}}, NewState())
	if !r.OK || r.Value == nil || *r.Value != 37 {
		t.Fatalf("FortiGate CPU OID: %+v", r)
	}
	u := Check(t.Context(), Task{ID: "u", Type: "SNMP_UPTIME", Host: host, SNMP: creds, Config: map[string]any{"snmpPort": port}}, NewState())
	if !u.OK || u.Value == nil || math.Abs(*u.Value-1000) > 0.01 {
		t.Fatalf("uptime 360000000 ticks = 1000 h: %+v", u)
	}
}

func TestSNMPWrongCommunityTimesOutClearly(t *testing.T) {
	host, port := snmpTarget(t)
	r := Check(t.Context(), Task{ID: "x", Type: "SNMP_OID", Host: host, SNMP: &SNMPCreds{Version: "2c", Community: "wrong"},
		Config: map[string]any{"oid": "1.3.6.1.2.1.1.3.0", "snmpPort": port}}, NewState())
	if r.OK || !strings.Contains(r.Message, "timed out") {
		t.Fatalf("%+v", r)
	}
}

func TestSNMPv3AuthPriv(t *testing.T) {
	host, port := snmpTarget(t)
	creds := &SNMPCreds{Version: "3"}
	creds.V3 = &struct {
		User      string `json:"user"`
		AuthProto string `json:"authProto"`
		AuthPass  string `json:"authPass"`
		PrivProto string `json:"privProto"`
		PrivPass  string `json:"privPass"`
	}{User: "nocuser", AuthProto: "SHA", AuthPass: "authpass123", PrivProto: "AES", PrivPass: "privpass123"}
	r := Check(t.Context(), Task{ID: "v3", Type: "SNMP_OID", Host: host, SNMP: creds,
		Config: map[string]any{"oid": "1.3.6.1.4.1.12356.101.4.1.3.0", "snmpPort": port, "snmpContext": "public"}}, NewState())
	if !r.OK || r.Value == nil || *r.Value != 37 {
		t.Fatalf("SNMPv3 authPriv: %+v", r)
	}
}
