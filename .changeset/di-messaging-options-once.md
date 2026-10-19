---
'@miiajs/messaging': patch
---

The options factory of `MessagingModule.configure((resolve) => ...)` runs once per app instead of once per provider, so it builds one transport and one idempotency store instead of three of each. `@On(topic, { bus: '' })` subscribes to the default bus instead of passing the startup check and never subscribing.
