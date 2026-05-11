# example-uws-app

Minimal CRUD API demonstrating `@miiajs/uws-server` (the uWebSockets.js HTTP adapter).

## Run

```bash
bun install
cd examples/uws-app
bun run dev
```

This example runs only on Node.js (`miia dev --runtime node`) - uWebSockets.js does not load on Bun or Deno.

## Endpoints

```
GET    /items
GET    /items/:id
POST   /items        { "name": "Foo", "price": 9.99 }
PUT    /items/:id    { "name": "Bar" }
DELETE /items/:id
```

## Native module compatibility

`uWebSockets.js` ≥20.61.0 ships a prebuilt binary that requires glibc ≥2.38. On older systems (Debian 12, Ubuntu 22.04) it fails to load. See [`packages/uws-server/README.md`](../../packages/uws-server/README.md) Troubleshooting for workarounds (newer base image, or fall back to `@miiajs/node-server`).

## License

MIT
