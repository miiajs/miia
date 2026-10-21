---
'@miiajs/messaging-redis': patch
---

A `subscribe()` still in progress (creating its group, connecting its lanes) when `onShutdown()` starts now closes its lanes and rejects with `subscribe() after shutdown started`, the same as one called after it. It used to resolve, and its consumer loop kept reading after the transport had shut down.
