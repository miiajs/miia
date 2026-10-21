---
'@miiajs/core': minor
---

`ConsoleLogger` takes a `colors` option (`new Miia({ logger: { colors: false } })`) and leaves ANSI colors out of the text format when `NO_COLOR` is set to a non-empty value, so logs written to a file or collected by `docker logs` carry no escape codes. On Deno the setting comes from `Deno.noColor`, which needs no `--allow-env`. An explicit `colors` wins over `NO_COLOR`; without either, output is colored as before.
