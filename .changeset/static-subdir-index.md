---
'@miiajs/serve-static': patch
---

The `index` file is served for subdirectories too, as "index file for directory requests" says: `GET /static/docs/` answers `docs/index.html`, and `GET /static/docs` redirects (301) to the slashed URL first, as the mount root does. Only the mount root had it - a subdirectory answered 404. A directory without an index file behaves as before (SPA fallback, else 404), and `index: false` turns both off.
