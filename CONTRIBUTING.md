# Contributing to MiiaJS

Thanks for your interest in contributing!

## Development setup

```sh
git clone https://github.com/miiajs/miia.git
cd miia
bun install
bun run build
bun run test
```

## Before opening a PR

- Run `bun run format` and `bun run typecheck`
- Add tests for new behavior (`bun run test`)
- Use conventional commit messages: `feat(core): ...`, `fix(auth): ...`, `docs: ...`
- For cross-package changes, explain the motivation in the PR description

## Reporting bugs

Open an issue at https://github.com/miiajs/miia/issues with:

- MiiaJS version, runtime (Bun/Node/Deno) and OS
- Minimal reproduction (ideally a stackblitz or tiny repo)
- Expected vs actual behavior

## Security issues

See [SECURITY.md](./SECURITY.md) - do not report security issues publicly.
