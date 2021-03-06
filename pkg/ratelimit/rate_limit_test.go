package ratelimit

import (
	"testing"
	"time"
)

func TestMonitor_RecommendedWaitForBackgroundOp(t *testing.T) {
	m := &Monitor{
		known:     true,
		limit:     5000,
		remaining: 1500,
		reset:     time.Now().Add(30 * time.Minute),
	}

	durationsApproxEqual := func(a, b time.Duration) bool {
		d := a - b
		if d < 0 {
			d = -1 * d
		}
		return d < 2*time.Second
	}

	// The conservative handling of rate limiting means that the 1500 remaining
	// will be treated as roughly 1200. For cost smaller than 1200, we should
	// expect a time of (reset + 3 minutes) * cost / 1200. For cost greater than
	// 1200, we should expect exactly reset + 3 minutes, because we won't wait
	// past the reset, as there'd be no point.
	tests := map[int]time.Duration{
		1:    0,
		10:   33 * time.Minute * 10 / 1200,
		100:  33 * time.Minute * 100 / 1200,
		500:  33 * time.Minute * 500 / 1200,
		3500: 33 * time.Minute,
	}
	for cost, want := range tests {
		if got := m.RecommendedWaitForBackgroundOp(cost); !durationsApproxEqual(got, want) {
			t.Errorf("for %d, got %s, want %s", cost, got, want)
		}
	}
	// Verify that we use the full limit, not the remaining limit, if the reset
	// time has passed. This should scale times based on 4,000 items in 63 minutes.
	m.reset = time.Now().Add(-1 * time.Second)
	tests = map[int]time.Duration{
		1:    0,                             // Things you could do >=500 times should just run
		10:   200 * time.Millisecond,        // Things you could do 250-500 times in the limit should get 200ms
		400:  63 * time.Minute * 400 / 4000, // 1/10 of 63 minutes
		9001: 3780 * time.Second,            // The full reset period
	}
	for cost, want := range tests {
		if got := m.RecommendedWaitForBackgroundOp(cost); !durationsApproxEqual(got, want) {
			t.Errorf("with reset: for %d, got %s, want %s", cost, got, want)
		}
	}
}
