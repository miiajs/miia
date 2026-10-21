---
'@miiajs/papr': patch
'@miiajs/mongoose': patch
---

The "Model ... not initialized" error names the model in the `register()` call it suggests: `PaprModule.register([users])` and `MongooseModule.register([User])`, instead of the token names `PaprModule.register([PaprModel(users)])` and `MongooseModule.register([MongooseModel(User)])`.
