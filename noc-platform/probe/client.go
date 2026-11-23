package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// Client talks to the server and buffers results while it is unreachable.
type Client struct {
	base, token string
	http        *http.Client
	mu          sync.Mutex
	buf         []Result
	dropped     int
}

const maxBuffered = 50000 // ~ a few hours of a busy probe; oldest dropped beyond this

func NewClient(server, token string, insecure bool) *Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if insecure {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // opt-in, lab use
	}
	return &Client{base: strings.TrimRight(server, "/"), token: token, http: &http.Client{Transport: tr, Timeout: 20 * time.Second}}
}

func (c *Client) req(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	r, err := http.NewRequestWithContext(ctx, method, c.base+path, rd)
	if err != nil {
		return nil, err
	}
	r.Header.Set("Authorization", "Bearer "+c.token)
	r.Header.Set("User-Agent", "noc-probe/"+Version)
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	return c.http.Do(r)
}

func (c *Client) FetchConfig(ctx context.Context) ([]Task, error) {
	host, _ := os.Hostname()
	res, err := c.req(ctx, http.MethodGet, "/api/probe/config?v="+url.QueryEscape(Version)+"&host="+url.QueryEscape(host), nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("server rejected the probe token (401): create or rotate it on the Probes page")
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned HTTP %d", res.StatusCode)
	}
	var out struct {
		Sensors []Task `json:"sensors"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(&out); err != nil {
		return nil, fmt.Errorf("bad config: %w", err)
	}
	return out.Sensors, nil
}

func (c *Client) Add(r Result) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.buf = append(c.buf, r)
	if over := len(c.buf) - maxBuffered; over > 0 {
		c.buf = c.buf[over:]
		c.dropped += over
	}
}

// Flush sends buffered results in batches; anything not accepted stays for the next try.
func (c *Client) Flush(ctx context.Context) {
	for {
		c.mu.Lock()
		n := min(len(c.buf), 2000)
		batch := append([]Result(nil), c.buf[:n]...)
		dropped := c.dropped
		c.mu.Unlock()
		if n == 0 {
			return
		}
		res, err := c.req(ctx, http.MethodPost, "/api/probe/results", map[string]any{"results": batch})
		if err != nil {
			log.Printf("send %d results: %v (kept, will retry)", n, err)
			return
		}
		io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
		res.Body.Close()
		if res.StatusCode == http.StatusBadRequest {
			log.Printf("server refused a batch of %d results (HTTP 400): dropping it", n)
		} else if res.StatusCode != http.StatusOK {
			log.Printf("send %d results: HTTP %d (kept, will retry)", n, res.StatusCode)
			return
		}
		c.mu.Lock()
		c.buf = c.buf[n:]
		if dropped > 0 {
			log.Printf("buffer was full while the server was unreachable: %d oldest results dropped", dropped)
			c.dropped = 0
		}
		c.mu.Unlock()
	}
}
