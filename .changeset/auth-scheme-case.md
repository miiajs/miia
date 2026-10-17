---
'@miiajs/auth': patch
---

`fromHeader()` matches the authentication scheme case-insensitively and skips extra spaces before the token, as RFC 9110 defines the `Authorization` header: `bearer <token>` used to come back as `null` and fail with 401 `Missing token`. An empty token after the scheme is still `null`.
