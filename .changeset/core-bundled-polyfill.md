---
'@miiajs/core': patch
---

A bundled app keeps its decorator metadata. `"sideEffects": false` let a bundler drop core's `Symbol.metadata` polyfill, so `wrangler`, `bun build` and esbuild produced an app that answered 404 on every route, or failed at start with `Cannot set properties of undefined` when a package compiled with `tsc` was in the bundle. The list now names `./dist/polyfill.js`, and the rest of the package stays tree-shakable.
