---
'@miiajs/jwt': patch
---

Default the signing algorithm by key type, like `verify()`

`sign()` put `HS256` in the token header whenever `algorithm` was not set, so signing with a `privateKey` (PEM or
`CryptoKey`) failed. It now defaults to `HS256` with a `secret` and `RS256` with a key, the same rule `verify()` and the
PEM import already use. EC and Ed keys still need an explicit `algorithm`.
