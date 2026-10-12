---
'@miiajs/messaging-redis': minor
---

Remove the transitional drain of the pre-0.7 retry sorted set

0.7.0 moved retries onto the consumer group PEL and kept draining the old `<topic>:retry` sorted set back into the
stream for rolling deploys from 0.6. The transport no longer reads that key, which also drops one Lua call per topic
every 10-60s from every process.
