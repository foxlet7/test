// noc-probe: polls the devices assigned to it and reports to the NOC Platform server.
//
// It only makes outbound HTTPS requests:
//
//	GET  {server}/api/probe/config   every 60 s: the work list
//	POST {server}/api/probe/results  every 5 s:  batched check results
//
// so it can run behind a customer's firewall with no inbound rule.
//
// Configuration (environment):
//
//	NOC_SERVER    server URL, e.g. https://noc.example.com        (required)
//	NOC_TOKEN     probe token from the Probes page                (required)
//	NOC_WORKERS   parallel checks, default 32
//	NOC_INSECURE  "1" to accept a self-signed server certificate (lab only)
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"
)

const Version = "0.1.0"

// Task is one sensor as the server describes it.
type Task struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	IntervalSec int            `json:"intervalSec"`
	Host        string         `json:"host"`
	Config      map[string]any `json:"config"`
	SNMP        *SNMPCreds     `json:"snmp"`
}

// Result is one check outcome, sent back in batches.
type Result struct {
	SensorID string         `json:"sensorId"`
	TS       string         `json:"ts"`
	OK       bool           `json:"ok"`
	Value    *float64       `json:"value,omitempty"`
	Message  string         `json:"message,omitempty"`
	Warn     bool           `json:"warn,omitempty"`
	Extra    map[string]any `json:"extra,omitempty"`
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[noc-probe] ")
	cfgFile := loadConfigFile()
	server, token := os.Getenv("NOC_SERVER"), os.Getenv("NOC_TOKEN")
	if server == "" || token == "" {
		log.Fatal("set NOC_SERVER and NOC_TOKEN (environment, or noc-probe.env next to the executable / /etc/noc-probe.env)")
	}
	workers := 32
	if n, err := strconv.Atoi(os.Getenv("NOC_WORKERS")); err == nil && n > 0 && n <= 512 {
		workers = n
	}
	client := NewClient(server, token, os.Getenv("NOC_INSECURE") == "1")
	if cfgFile != "" {
		log.Printf("config file %s", cfgFile)
	}
	log.Printf("v%s starting: server %s, %d workers", Version, server, workers)
	if runAsService(func(ctx context.Context) { Run(ctx, client, workers) }) {
		log.Print("service stopped")
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	Run(ctx, client, workers)
	log.Print("stopped")
}

// Run is the probe loop: refresh config, schedule due checks onto a worker pool, flush results.
func Run(ctx context.Context, c *Client, workers int) {
	var (
		mu       sync.Mutex
		tasks    = map[string]Task{}
		next     = map[string]time.Time{}
		inflight = map[string]bool{}
	)
	state := NewState()
	queue := make(chan Task, workers*4)

	for i := 0; i < workers; i++ {
		go func() {
			for t := range queue {
				r := Check(ctx, t, state)
				c.Add(r)
				mu.Lock()
				delete(inflight, t.ID)
				mu.Unlock()
			}
		}()
	}

	refresh := func() {
		list, err := c.FetchConfig(ctx)
		if err != nil {
			log.Printf("config: %v", err)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		seen := map[string]bool{}
		for _, t := range list {
			seen[t.ID] = true
			if _, ok := tasks[t.ID]; !ok {
				// spread first checks over a few seconds so 500 sensors don't fire at once
				next[t.ID] = time.Now().Add(time.Duration(len(next)%10) * 500 * time.Millisecond)
			}
			tasks[t.ID] = t
		}
		for id := range tasks {
			if !seen[id] {
				delete(tasks, id)
				delete(next, id)
				state.Forget(id)
			}
		}
	}
	refresh()

	cfgTick := time.NewTicker(60 * time.Second)
	flushTick := time.NewTicker(5 * time.Second)
	schedTick := time.NewTicker(500 * time.Millisecond)
	defer cfgTick.Stop()
	defer flushTick.Stop()
	defer schedTick.Stop()

	for {
		select {
		case <-ctx.Done():
			close(queue)
			flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			c.Flush(flushCtx)
			cancel()
			return
		case <-cfgTick.C:
			refresh()
		case <-flushTick.C:
			c.Flush(ctx)
		case now := <-schedTick.C:
			mu.Lock()
			for id, t := range tasks {
				if inflight[id] || now.Before(next[id]) {
					continue
				}
				interval := time.Duration(max(15, t.IntervalSec)) * time.Second
				select {
				case queue <- t:
					inflight[id] = true
					next[id] = now.Add(interval)
				default: // workers busy: try again on the next tick
				}
			}
			mu.Unlock()
		}
	}
}
