---
'@miiajs/serve-static': patch
---

The path check that keeps a request inside `root` wants a separator after it, so a sibling directory whose name starts with the root's (`public2` next to `public`) is turned away before any filesystem call, as the docs say. Only the `realpath()` check stood behind it, and that one looks at where a path leads: with `dotfiles: true`, a `..` path into such a sibling was served when a symlink there led back into the root.
