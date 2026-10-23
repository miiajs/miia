---
'@miiajs/core': patch
---

The `logger` option of `new Miia()` replaces the process-wide logger only while the app lives: `destroy()` puts back the logger it replaced, unless another one has been installed since. A `TestApp` (`logger: false`) used to silence `Logger` for the rest of the process; after `close()` logging works again.
