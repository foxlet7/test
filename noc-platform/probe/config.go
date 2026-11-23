package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// loadConfigFile reads KEY=VALUE lines (NOC_SERVER, NOC_TOKEN, ...) from the first file found:
// $NOC_CONFIG, noc-probe.env next to the executable, /etc/noc-probe.env.
// Real environment variables win, so containers can still be configured with -e.
func loadConfigFile() string {
	var paths []string
	if p := os.Getenv("NOC_CONFIG"); p != "" {
		paths = append(paths, p)
	}
	if exe, err := os.Executable(); err == nil {
		paths = append(paths, filepath.Join(filepath.Dir(exe), "noc-probe.env"))
	}
	paths = append(paths, "/etc/noc-probe.env")
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
			if _, set := os.LookupEnv(k); !set {
				os.Setenv(k, v)
			}
		}
		f.Close()
		return p
	}
	return ""
}
