---
'@miiajs/messaging': minor
'@miiajs/messaging-redis': minor
---

Give every process its own broadcast group

Broadcast groups now end in `<hostname>_<pid>_<token>`, with a random token drawn once per process, where they ended in
`<hostname>_<pid>`. Replicas that share hostname and pid - host-network containers that all run as pid 1 - derived the
same group, split its copies between them, and the first to shut down destroyed it for the others. Each now gets its
own group and its own copy of every message. The token is kept on `globalThis`, so two copies of `@miiajs/messaging`
in one process agree on it.

The Redis transport reads the owner off each broadcast group's name instead of computing it, so its liveness key always
matches the group the bus formed, and its orphan cleanup recognises both shapes: groups left by releases before the
token are still removed once their owner is gone. A broadcast group subscribed directly under a name without that
suffix gets no liveness key and no orphan cleanup.
