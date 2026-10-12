---
'@miiajs/core': patch
'@miiajs/node-server': patch
'@miiajs/uws-server': patch
'@miiajs/multipart': patch
'@miiajs/serve-static': patch
'@miiajs/testing': patch
'@miiajs/auth': patch
'@miiajs/jwt': patch
'@miiajs/config': patch
'@miiajs/rate-limit': patch
'@miiajs/swagger': patch
'@miiajs/messaging': patch
'@miiajs/messaging-redis': patch
'@miiajs/drizzle': patch
'@miiajs/papr': patch
'@miiajs/mongoose': patch
'@miiajs/cli': patch
---

Lower the runtime floors to what the packages need.

Node moves from `24.18.1` to `22.12.0`. Nothing in the packages needs Node 24. 22.12.0 is the first
22.x release where `require(esm)` is on by default, so CommonJS code can `require()` these ESM-only
packages, and it is the floor `papr@17` declares. The old floor tracked the 24.17.0 and 24.18.1
security releases; `engines` cannot enforce a patch level, so that advice now lives in `SECURITY.md`.

Deno moves from `2.6.1` to `2.0.0`, with two exceptions. Projects that `@miiajs/cli` runs on Deno
need 2.4.0, the first release with the `--sloppy-imports` flag the CLI passes. `@miiajs/serve-static`
needs 2.5.0: on 2.0 through 2.4 Deno's `Readable.toWeb` throws an uncaught error once a file has been
sent and takes the process down.

`@miiajs/uws-server` now declares Node.js 22, 24 and 26 only, with no Bun or Deno range:
uWebSockets.js ships binaries for those three lines and never loaded anywhere else.
`@miiajs/node-server` drops its Deno range: Deno apps listen through `Deno.serve` and never need the
adapter, and it is not tested there.

Bun stays at `1.4.0`.

The documented TypeScript requirement moves from 5.7 to 6.0. The `ES2025` target that the docs and
`miia new` use does not exist before TypeScript 6.0, so 5.7 through 5.9 never worked with that setup.
