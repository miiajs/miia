---
'@miiajs/cli': minor
---

`miia --version`; runtime detection reads `deno.json` and lockfiles in parent directories, so a Deno project installed with pnpm runs on Deno; `miia start` returns the app's exit code and forwards termination signals without cutting a graceful shutdown short; `miia dev` keeps a `NODE_ENV` you set, no longer restarts the watcher and keeps serving when type-checking stops; `dev`, `start` and `build` name the runtime only when it was detected, not given with `--runtime`, and `dev` prints the result of type-checking without progress lines; executables are found without `which`, including `.cmd`/`.exe` shims on Windows.
