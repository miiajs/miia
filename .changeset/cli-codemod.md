---
'@miiajs/cli': minor
---

`typescript` is a peer dependency of the CLI: module registration in `miia g` edits files through the TypeScript compiler API and keeps the rest of the file byte for byte (EOL, indent, comments), recognizes `forwardRef(() => X)`, `X.configure(...)`, shorthand and quoted keys, and warns instead of guessing on arrays held in variables or spreads. Registration errors are no longer swallowed, and `--dry-run` prints the same set of changes that a real run writes
