---
'@miiajs/messaging': minor
'@miiajs/messaging-redis': patch
---

Handlers drain in `onShutdown()`, before any provider's `onDestroy()`: the bus unsubscribes and the transports stop consuming and wait for in-flight handlers there, so a database your handlers write to closes after they finish, wherever its module sits. New optional `MessageTransport.onShutdown()`; the in-memory and Redis transports implement it, and their `onDestroy()` drains first when called alone. The Redis transport destroys every broadcast group it subscribed to in `onDestroy()`, including ones unsubscribed earlier, and rejects `subscribe()` once shutdown has started. Breaking: `MessageBus.onDestroy()` is renamed to `onShutdown()`.
