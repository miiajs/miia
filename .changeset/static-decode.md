---
'@miiajs/serve-static': patch
---

Files whose names need percent-encoding in a URL are served. The router hands the wildcard over still encoded, so `GET /static/hello%20world.txt` looked for a file literally named `hello%20world.txt` and answered 404; the same for any non-ASCII name. The path is now decoded before the dotfile and traversal checks, which run on the decoded form. Malformed percent-encoding or an encoded NUL answers 400.
