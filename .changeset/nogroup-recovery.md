---
'@miiajs/messaging-redis': patch
---

Recover consumer lanes when their group disappears

A lane whose consumer group or stream vanished under it - Redis restarted without persistence, `FLUSHALL`, the key
evicted, a manual `DEL` or `XGROUP DESTROY` - logged one warning and stopped reading for good, on every replica, until
the process restarted. It now recreates the group and keeps reading.

The group is recreated at the highest position the process knows for it: where the group stood when the process
subscribed, or the last entry it has read since. The subscription's `initialPosition` applies only when that is
unknown. Entries other replicas consumed past that point are delivered again - `@Idempotent` covers them. Entries in
flight at that moment lose their retry state, and retries parked in a destroyed group are gone.

A lane notices a deletion at once.

Deleting a stream or a group under live consumers no longer sticks: `MKSTREAM` brings the stream back and the group is
recreated. Stop the consumers first; move a group with `XGROUP SETID`.
