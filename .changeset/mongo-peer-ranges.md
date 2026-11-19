---
'@miiajs/mongoose': minor
'@miiajs/papr': minor
---

Older drivers are supported. `@miiajs/mongoose` takes `mongoose` `^7.0.0 || ^8.0.0 || ^9.0.0` (was `^9.4.1`), and `@miiajs/papr` takes `papr` `^15.0.0 || ^16.0.0 || ^17.0.0` with `mongodb` `^6.0.0 || ^7.0.0` (was `papr` `^17.0.0` with `mongodb` `^7.1.1`), so an app that still runs mongoose 7 or 8, or the mongodb 6 driver, can use them. papr's own peer range still decides which driver goes with it: `mongodb` 6 for papr 15, 7 for papr 16 and 17.
