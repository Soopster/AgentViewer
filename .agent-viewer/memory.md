# Coordinator project memory

Durable facts, decisions, and gotchas coordinator agents have recorded for this project. Persists across every run — edit freely.

## 2026-08-09T09:43:39.982Z — lead
OpenTUI performance: combine split-pane mtime/activity poll gating, tokenized unchanged worker deliveries, and single-pass formatter analysis.

Measured in run 6ca9c763-1e3d-47e5-bb6a-2ad4cc6b54a8: full 9-scenario transcript pipeline medians improved about 89-92%; unchanged split-pane clone peak heap fell 90.9%; tokenized worker delivery transfer fell 95.0% and peak heap 88.7%. Preserve mutation/truncation and card-variant fallbacks, delivery-token baseline binding, 80-card split-pane window/scroll state, and exact transcript checksums. Full pipeline RSS/peak heap can be allocator-noisy, so use focused steady-state clone/transport benchmarks plus post-GC heap and exact-output checks for memory claims.
