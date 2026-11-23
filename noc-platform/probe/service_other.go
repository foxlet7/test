//go:build !windows

package main

import "context"

func runAsService(func(ctx context.Context)) bool { return false }
