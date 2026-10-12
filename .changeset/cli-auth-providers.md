---
'@miiajs/cli': patch
---

Name the scaffolded auth files after providers

`miia new` with JWT Auth generated `src/auth/strategies/jwt.strategy.ts` and `local.strategy.ts`, a leftover from the
strategy-based API - the classes inside were already `AuthProvider`s. It now writes
`src/auth/providers/jwt-auth.provider.ts` and `src/auth/providers/local-auth.provider.ts`, the names the docs and the
full-app example use.
