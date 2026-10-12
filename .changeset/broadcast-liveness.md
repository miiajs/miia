---
'@miiajs/messaging-redis': patch
---

Stop broadcast orphan cleanup from destroying live siblings

Orphan cleanup took every broadcast group of the same handler on the same host with another pid for a dead previous
incarnation. On a host running several live processes (a PM2 cluster, several workers per container), each subscribe
destroyed its siblings' live broadcast groups. Orphans left by crashed replicas on other hosts were never cleaned up.

A process with broadcast subscriptions now keeps a liveness key, `miia:messaging:alive:<hostname>_<pid>_<token>`
(`PX 30000`, refreshed every 10s, never deleted - it expires). On subscribe, and once more about 40s later, a broadcast
group of the same handler is removed only when its owner's key has expired, whatever host it came from. Live siblings
are left alone, and crashed replicas' orphans go away shortly after a replacement starts, wherever it lands.

**ACL.** The publisher client needs `SET` and `EXISTS` on `~miia:messaging:alive:*`. When `SET` is denied, the
transport logs one warning and turns off liveness and orphan cleanup.

**Rolling upgrade.** Older replicas write no liveness key, so new replicas remove their broadcast groups on start, and
the old replicas, which cannot recreate a group, stop receiving broadcasts until they are replaced.
