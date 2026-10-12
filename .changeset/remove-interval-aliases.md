---
'@miiajs/messaging-redis': minor
---

Remove the `retrySchedulerIntervalMs` and `reclaimIntervalMs` options

Both have been deprecated aliases of `retryIntervalMs` since 0.7.0 and are no longer read. Use `retryIntervalMs`.
