---
'@miiajs/core': patch
---

Shorter advice in two rare errors. The "No provider" line about another token with the same name and hint now reads `register this one too if both are intended, otherwise deduplicate the package that defines it`, and a cycle that exists only through `deps` ends with `deps of A lists B: drop that entry, or move the shared logic into a provider both depend on`.
