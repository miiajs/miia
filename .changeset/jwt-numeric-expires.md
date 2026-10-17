---
'@miiajs/jwt': patch
---

A numeric `expiresIn` or `notBefore` is a number of seconds from signing, as the options table says (`expiresIn: 3600` is an hour). It used to reach `jose` as an absolute timestamp, so `expiresIn: 3600` signed tokens that had expired in 1970 and every `verify()` rejected them. Time span strings (`'1h'`, `'30s'`) are unchanged.
