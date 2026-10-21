---
'@miiajs/messaging': patch
---

`@Idempotent` takes the payload type from its `key` function, so `key: (p: Payment) => p.id` compiles without casting the payload from `unknown`
