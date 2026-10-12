---
'@miiajs/messaging-redis': patch
---

Drop a stream entry whose `data` is JSON but not a message envelope

An entry like `{}` or `null` (a hand-written `XADD`, another producer on the same stream) threw past the parse guard,
stayed pending and came back once per retry horizon forever without reaching the DLQ, failing that group's retry sweep
each time once its budget ran out. It is now acked and logged the way unparseable JSON already was.
