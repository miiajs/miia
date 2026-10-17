---
'@miiajs/jwt': patch
---

A key passed to `sign()` or `verify()` wins over the key of the module, as "per-call options override module defaults" promises. A module configured with `secret` used to sign with that secret even when the call passed a `privateKey`, and fail on the RS256/HMAC mismatch. The algorithm of a per-call key is the call's `algorithm` (`algorithms` for `verify()`), else the module's when it fits the kind of key (`HS*` for a secret, any other for a key pair), else `HS256` for a secret and `RS256` for a key.
