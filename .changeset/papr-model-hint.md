---
'@miiajs/papr': patch
---

The "No provider" error for a model names the call that provides it, `PaprModule.register([users])`, instead of `PaprModule.register([...])`, as `@miiajs/mongoose` already does.
