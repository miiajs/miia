---
'@miiajs/uws-server': patch
---

Bump uWebSockets.js to v20.69.0.

A routine move of the pin, kept separate from the backpressure work that landed alongside it so it
can be read on its own. The adapter's API surface is unchanged: `pause()` and `resume()`, which the
backpressure fix uses, were already there in v20.68.0, and the only addition upstream is
`beginWrite()`, which nothing here calls.

The install line moves with the pin - `uWebSockets.js` is fetched from GitHub, not npm, so the
version lives in the command:

```sh
bun add @miiajs/uws-server uWebSockets.js@uNetworking/uWebSockets.js#v20.69.0
```

The prebuilt native binary still loads on Node 22, 24 and 26 only.
