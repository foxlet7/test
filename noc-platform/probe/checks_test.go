package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func task(typ, host string, cfg map[string]any) Task {
	return Task{ID: "s1", Type: typ, Host: host, IntervalSec: 60, Config: cfg}
}

func TestTCPOpenAndClosed(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	r := Check(context.Background(), task("TCP", "127.0.0.1", map[string]any{"port": float64(port)}), NewState())
	if !r.OK || r.Value == nil {
		t.Fatalf("open port: %+v", r)
	}
	ln.Close()
	r = Check(context.Background(), task("TCP", "127.0.0.1", map[string]any{"port": float64(port)}), NewState())
	if r.OK || r.Message != "port "+strconv.Itoa(port)+": connection refused" {
		t.Fatalf("closed port: %+v", r)
	}
}

func TestHTTPStatusKeywordAndUntrustedCert(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/bad" {
			w.WriteHeader(503)
		}
		w.Write([]byte("hello NOC"))
	}))
	defer srv.Close()
	st := NewState()
	if r := Check(context.Background(), task("HTTP", "x", map[string]any{"url": srv.URL + "/", "keyword": "NOC"}), st); !r.OK {
		t.Fatalf("ok page: %+v", r)
	}
	if r := Check(context.Background(), task("HTTP", "x", map[string]any{"url": srv.URL + "/bad"}), st); r.OK || r.Message != "HTTP 503" {
		t.Fatalf("503: %+v", r)
	}
	if r := Check(context.Background(), task("HTTP", "x", map[string]any{"url": srv.URL + "/", "keyword": "missing"}), st); r.OK {
		t.Fatalf("keyword: %+v", r)
	}
	tls := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer tls.Close()
	r := Check(context.Background(), task("HTTP", "x", map[string]any{"url": tls.URL}), st)
	if r.OK || !strings.Contains(r.Message, "TLS certificate invalid") {
		t.Fatalf("self-signed cert must be reported: %+v", r)
	}
}

func TestUnknownTypeAndBadConfigNeverPanic(t *testing.T) {
	st := NewState()
	if r := Check(context.Background(), task("FOO", "x", nil), st); r.OK || !strings.Contains(r.Message, "unsupported") {
		t.Fatalf("%+v", r)
	}
	if r := Check(context.Background(), task("SNMP_OID", "127.0.0.1", map[string]any{"oid": "1.3.6.1.2.1.1.3.0"}), st); r.OK || !strings.Contains(r.Message, "not configured") {
		t.Fatalf("snmp without creds: %+v", r)
	}
	if r := Check(context.Background(), task("TCP", "x", map[string]any{"port": "abc"}), st); r.OK {
		t.Fatalf("bad port: %+v", r)
	}
}

func TestPingLocalhost(t *testing.T) {
	r := Check(context.Background(), task("PING", "127.0.0.1", map[string]any{"count": float64(2)}), NewState())
	if !r.OK {
		t.Skipf("ICMP not permitted in this environment: %s", r.Message)
	}
	if r.Value == nil || *r.Value < 0 {
		t.Fatalf("%+v", r)
	}
}

// End to end against a fake server: config fetch, scheduling, batched results with the token.
func TestRunAgainstFakeServer(t *testing.T) {
	var posted atomic.Int32
	var badAuth atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			badAuth.Add(1)
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/probe/config":
			json.NewEncoder(w).Encode(map[string]any{"sensors": []Task{
				{ID: "a", Type: "TCP", Host: "127.0.0.1", IntervalSec: 15, Config: map[string]any{"port": float64(1)}},
			}})
		case "/api/probe/results":
			var body struct{ Results []Result }
			json.NewDecoder(r.Body).Decode(&body)
			posted.Add(int32(len(body.Results)))
			w.Write([]byte(`{"accepted":1}`))
		}
	}))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()
	Run(ctx, NewClient(srv.URL, "tok", false), 4)
	if posted.Load() < 1 || badAuth.Load() != 0 {
		t.Fatalf("posted=%d badAuth=%d", posted.Load(), badAuth.Load())
	}
}

func TestClientKeepsResultsWhileServerDown(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok", false)
	c.Add(Result{SensorID: "a", OK: true})
	c.Flush(context.Background())
	if len(c.buf) != 1 {
		t.Fatalf("result must be kept for retry, buf=%d", len(c.buf))
	}
}
