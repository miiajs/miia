---
'@miiajs/cli': patch
---

Normalize the `miia` bin path in `package.json` (`./dist/bin.js` → `dist/bin.js`) to avoid issues with package managers that do not accept the leading `./` in `bin` entries.
