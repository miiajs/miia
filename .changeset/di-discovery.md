---
'@miiajs/core': minor
'@miiajs/swagger': patch
'@miiajs/messaging': patch
---

`DiscoveryService` returns only what carries a metadata key: new `getClassesWithMeta(key)` (`{ instance, ctor, metadata }` per instance whose class has metadata under `key`, type `DiscoveredClass`) next to `getMethodsWithMeta(key)`. Metadata is read from the class of each instance, so a handler class behind a factory provider is discovered; an instance under two tokens is listed once, and a lazy proxy is skipped. Swagger collects controllers through `getClassesWithMeta(RESOLVED_PREFIX)`. Breaking:

- `DiscoveryService.getSingletons()` is removed - use `getClassesWithMeta(key)`
- a factory-provided instance is discovered by its own class, and a plain-object mock (`TestApp.override(Handler, { ... })`) is not discovered at all: its `@On` methods are not subscribed and a mocked controller drops out of the swagger spec - override with a named subclass (`class FakeHandler extends Handler {}`) to keep it
- calling `getClassesWithMeta()` / `getMethodsWithMeta()` before every provider is constructed (a constructor, a field initializer, `app.get()` without `init()`) throws - call them from `onReady()` or `onInit()`
- messaging: consumer group names and default idempotency keys come from the class of the handler instance - a factory that returns a subclass for a class token renames the group, and retries parked under the old group are orphaned; the same `@On` class provided twice fails at startup
