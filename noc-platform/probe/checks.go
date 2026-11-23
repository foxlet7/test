package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	probing "github.com/prometheus-community/pro-bing"
)

// State keeps what a check needs between runs (SNMP counters, uptime, resolved ifIndex).
type State struct {
	mu   sync.Mutex
	data map[string]map[string]any
}

func NewState() *State { return &State{data: map[string]map[string]any{}} }

func (s *State) Get(id, key string) (any, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.data[id][key]
	return v, ok
}

func (s *State) Set(id, key string, v any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data[id] == nil {
		s.data[id] = map[string]any{}
	}
	s.data[id][key] = v
}

func (s *State) Forget(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, id)
}

// Check runs one task and never panics: a bad config becomes a failed result, not a dead probe.
func Check(ctx context.Context, t Task, st *State) (r Result) {
	start := time.Now()
	defer func() {
		if p := recover(); p != nil {
			r = fail(t, fmt.Sprintf("probe error: %v", p))
		}
		r.SensorID = t.ID
		r.TS = start.UTC().Format(time.RFC3339Nano)
	}()
	switch t.Type {
	case "PING":
		return checkPing(ctx, t)
	case "TCP":
		return checkTCP(ctx, t)
	case "HTTP":
		return checkHTTP(ctx, t)
	case "DNS":
		return checkDNS(ctx, t)
	case "SNMP_TRAFFIC":
		return checkSNMPTraffic(t, st)
	case "SNMP_OID":
		return checkSNMPOID(t)
	case "SNMP_UPTIME":
		return checkSNMPUptime(t, st)
	}
	return fail(t, "unsupported sensor type "+t.Type+" (update the probe)")
}

func fail(t Task, msg string) Result { return Result{SensorID: t.ID, OK: false, Message: msg} }
func val(v float64) *float64         { v = math.Round(v*1000) / 1000; return &v }

// config helpers (JSON numbers arrive as float64)
func cfgNum(t Task, k string, def float64) float64 {
	switch v := t.Config[k].(type) {
	case float64:
		return v
	case string:
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}

func cfgStr(t Task, k string) string {
	if v, ok := t.Config[k].(string); ok {
		return v
	}
	return ""
}

// ---------------------------------------------------------------- ping

func checkPing(ctx context.Context, t Task) Result {
	count := int(math.Max(1, math.Min(10, cfgNum(t, "count", 4))))
	p, err := probing.NewPinger(t.Host)
	if err != nil {
		return fail(t, "cannot resolve "+t.Host+": "+err.Error())
	}
	p.Count = count
	p.Interval = 250 * time.Millisecond
	p.Timeout = time.Duration(count)*300*time.Millisecond + 2*time.Second
	// Raw ICMP needs root/CAP_NET_RAW (Linux) or Administrator (Windows); otherwise use
	// unprivileged "UDP ping" (Linux: net.ipv4.ping_group_range must include the user).
	p.SetPrivileged(runtime.GOOS == "windows" || os.Geteuid() == 0 || os.Getenv("NOC_PRIVILEGED_PING") == "1")
	if err := p.RunWithContext(ctx); err != nil {
		return fail(t, "ping failed: "+err.Error())
	}
	s := p.Statistics()
	if s.PacketsRecv == 0 {
		return Result{OK: false, Message: fmt.Sprintf("Request timed out (%d/%d lost)", s.PacketsSent, s.PacketsSent), Extra: map[string]any{"lossPct": 100.0}}
	}
	r := Result{OK: true, Value: val(float64(s.AvgRtt.Microseconds()) / 1000), Extra: map[string]any{
		"lossPct": math.Round(s.PacketLoss*10) / 10, "minMs": float64(s.MinRtt.Microseconds()) / 1000, "maxMs": float64(s.MaxRtt.Microseconds()) / 1000,
	}}
	if s.PacketLoss > 0 {
		r.Warn = true
		r.Message = fmt.Sprintf("%.0f%% packet loss", s.PacketLoss)
	}
	return r
}

// ---------------------------------------------------------------- tcp

func checkTCP(ctx context.Context, t Task) Result {
	port := int(cfgNum(t, "port", 0))
	if port < 1 || port > 65535 {
		return fail(t, "invalid port")
	}
	d := net.Dialer{Timeout: 5 * time.Second}
	start := time.Now()
	c, err := d.DialContext(ctx, "tcp", net.JoinHostPort(t.Host, strconv.Itoa(port)))
	if err != nil {
		return fail(t, fmt.Sprintf("port %d: %v", port, cleanErr(err)))
	}
	c.Close()
	return Result{OK: true, Value: val(float64(time.Since(start).Microseconds()) / 1000)}
}

// ---------------------------------------------------------------- http(s)

func checkHTTP(ctx context.Context, t Task) Result {
	u := cfgStr(t, "url")
	if u == "" {
		return fail(t, "no URL configured")
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	// Verify certificates normally; an invalid certificate is a finding, reported below.
	client := &http.Client{Transport: tr, Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fail(t, "bad URL: "+err.Error())
	}
	req.Header.Set("User-Agent", "noc-probe/"+Version)
	start := time.Now()
	res, err := client.Do(req)
	if err != nil {
		var cv *tls.CertificateVerificationError
		if errors.As(err, &cv) {
			return fail(t, "TLS certificate invalid: "+cv.Err.Error())
		}
		return fail(t, cleanErr(err))
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	ms := float64(time.Since(start).Microseconds()) / 1000
	r := Result{OK: true, Value: val(ms), Extra: map[string]any{"status": res.StatusCode}}

	want := int(cfgNum(t, "expectStatus", 0))
	if (want > 0 && res.StatusCode != want) || (want == 0 && res.StatusCode >= 400) {
		return Result{OK: false, Message: fmt.Sprintf("HTTP %d", res.StatusCode), Extra: r.Extra}
	}
	if kw := cfgStr(t, "keyword"); kw != "" && !strings.Contains(string(body), kw) {
		return Result{OK: false, Message: fmt.Sprintf("response does not contain %q", kw), Extra: r.Extra}
	}
	if res.TLS != nil && len(res.TLS.PeerCertificates) > 0 {
		days := time.Until(res.TLS.PeerCertificates[0].NotAfter).Hours() / 24
		r.Extra["certDays"] = math.Floor(days)
		if limit := cfgNum(t, "tlsWarnDays", 14); limit > 0 && days < limit {
			r.Warn = true
			r.Message = fmt.Sprintf("TLS certificate expires in %.0f days", math.Floor(days))
		}
	}
	return r
}

// ---------------------------------------------------------------- dns (asks the device itself)

func checkDNS(ctx context.Context, t Task) Result {
	q := cfgStr(t, "query")
	if q == "" {
		return fail(t, "no name to resolve")
	}
	server := net.JoinHostPort(t.Host, "53")
	res := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
		d := net.Dialer{Timeout: 4 * time.Second}
		return d.DialContext(ctx, network, server)
	}}
	cctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	start := time.Now()
	addrs, err := res.LookupHost(cctx, q)
	if err != nil {
		return fail(t, cleanErr(err))
	}
	ms := float64(time.Since(start).Microseconds()) / 1000
	if want := cfgStr(t, "expect"); want != "" {
		found := false
		for _, a := range addrs {
			if a == want {
				found = true
			}
		}
		if !found {
			return Result{OK: false, Message: fmt.Sprintf("%s resolved to %s, expected %s", q, strings.Join(addrs, ", "), want)}
		}
	}
	return Result{OK: true, Value: val(ms), Message: strings.Join(addrs, ", ")}
}

// Shorter, operator-friendly error text.
func cleanErr(err error) string {
	s := err.Error()
	switch {
	case strings.Contains(s, "connection refused"):
		return "connection refused"
	case strings.Contains(s, "i/o timeout"), strings.Contains(s, "deadline exceeded"), strings.Contains(s, "Client.Timeout"):
		return "timed out"
	case strings.Contains(s, "no such host"):
		return "name not found"
	case strings.Contains(s, "network is unreachable"), strings.Contains(s, "no route to host"):
		return "no route to host"
	}
	if i := strings.LastIndex(s, ": "); i > 0 && len(s) > 120 {
		return s[i+2:]
	}
	return s
}
