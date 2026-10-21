---
'@miiajs/core': patch
---

`app.provide(Class)` registers the class in the scope its `@Injectable({ scope })` declares, as a module's `providers` does. It always made a singleton, so a `transient` or `request` class provided this way was shared.
