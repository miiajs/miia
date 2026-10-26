---
'@miiajs/core': minor
---

New `onShutdown()` lifecycle hook. `destroy()` closes the server, then runs `onShutdown()` on every singleton (stop taking new work, wait for work in flight, stay usable), then `onDestroy()` on every singleton (release resources), both in reverse dependency order. A failing hook or server close no longer stops the rest: `destroy()` runs every step, logs each failure with its source (`X.onDestroy() failed during shutdown`) and throws afterwards - the error itself for one failure, an `AggregateError` for several. A `destroy()` called while one is running gets the same promise instead of running the hooks twice, and a later one does not close the server again.
