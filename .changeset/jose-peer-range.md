---
'@miiajs/jwt': minor
---

jose 5 is supported: `@miiajs/jwt` takes `jose` `^5.0.0 || ^6.0.0` (was `^6.0.0`). With jose 5 on Node, a key from its `generateKeyPair()` or `importPKCS8()` is a `KeyObject`, which works but does not match the `string | CryptoKey` type of `privateKey` / `publicKey`: pass the PEM string or cast.
