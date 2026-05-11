# @miiajs/uws-server

uWebSockets.js HTTP server adapter for MiiaJS.

## Installation

```bash
npm install @miiajs/uws-server uWebSockets.js
```

## Documentation

**[miiajs.com/docs/packages/uws-server](https://miiajs.com/docs/packages/uws-server)**

## Troubleshooting

### Native module fails to load on Debian 12 / older glibc systems

`uWebSockets.js` ≥20.61.0 ships a prebuilt native binary that depends on a
newer glibc than what Debian 12 (bookworm) provides. On affected systems you
will see at startup:

```
Error: This version of uWS.js supports only Node.js versions ...
TypeError: symbol 'napi_register_module_v1' not found in native module
```

**Why we can't simply downgrade:** `@miiajs/uws-server` uses APIs introduced
in `uWebSockets.js@20.61.0`, so pinning an older version will break the
adapter at build/startup.

**Workarounds (in order of preference):**

1. **Use a newer base image / OS** - Debian 13, Ubuntu 24.04, or any distro with
   glibc ≥2.38. This is the only solution that keeps full uWS performance.
2. **Switch to `@miiajs/node-server`** - same API surface (`app.listen(port, host, serve)`),
   slightly lower throughput but no native dependency. Drop-in replacement for
   environments where the host OS cannot be upgraded.
3. **Track upstream** - follow https://github.com/uNetworking/uWebSockets.js/issues
   for an official fix; once published, MiiaJS will adopt it without breaking changes.

## License

MIT
