---
'@miiajs/core': patch
---

The "No provider" line about another token with the same name and hint no longer assumes two copies of a package: it names both causes - the token defined twice on purpose (two `defineModel('User', ...)` calls, one per connection) or a duplicated package.
