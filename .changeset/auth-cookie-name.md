---
'@miiajs/auth': patch
---

`fromCookie(name)` matches the cookie name literally. The name went into a regular expression unescaped, so `fromCookie('a.b')` also read a cookie named `axb`, and a name with `+` or `(` never matched or threw. The value is still returned raw, as documented.
