---
'@miiajs/swagger': patch
---

`@ApiHeader`, `@ApiSecurity` and `@ApiExclude` on a subclass no longer write into the metadata of its parent class. A subclass reads the parent's map or set through the metadata prototype and used to add to it in place, so a header or security requirement declared on a subclass showed up on the parent's operations too, and `@ApiExclude()` on a subclass hid the parent's routes. The inherited value is now copied before the first write. The decorators built on the core metadata helpers (`@ApiParam`, `@ApiQuery`, `@ApiResponse`, `@ApiBody`, `@ApiOperation`) get the same fix from those helpers.
