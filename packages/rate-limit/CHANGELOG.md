# @miiajs/rate-limit

## 0.3.0

### Minor Changes

- [`cdb17d8`](https://github.com/miiajs/miia/commit/cdb17d8fe4612fdf0f803ff197bf6cdc7cfe5675) Thanks [@RuslanMatiushev](https://github.com/RuslanMatiushev)! - Add `@miiajs/rate-limit`: fixed-window rate limiting with a guard flow and a perimeter middleware.

  The primary path is the guard flow: `RateLimitModule.configure({ limit, window })` plus
  `app.useGuard(RateLimitGuard)` for app-wide enforcement, with `@RateLimit(policy)` and
  `@SkipRateLimit()` for per-route control. `@RateLimit` uses replacement semantics, the same
  precedence as `@BodyLimit` (method > class > global) - a decorated route keeps its own bucket
  and does not consume the global quota; `@SkipRateLimit()` disables limiting on its scope. The
  `rateLimit()` middleware is the perimeter form: standalone (no DI) and the only layer that
  covers unmatched routes (404s). Both wrap the same `RateLimiter` core (Upstash-style
  `limit(key)` result object), share a pluggable `RateLimitStore` contract whose `increment()`
  counts the hit and decides blocking atomically (ready for a future Redis Lua store), ship an
  in-memory `MemoryStore`, support `blockDuration` bans, and emit draft-6 `RateLimit-*` headers
  (`legacy` / `false` modes available) with `Retry-After` on 429.

  `blockDuration` also supports optional geometric backoff: `blockBackoff` grows the ban per repeat
  offence (`blockDuration`, `blockDuration × blockBackoff`, ...) up to `maxBlockDuration`, with strikes
  that reset after a `strikeReset` grace period measured from the end of the block. It is opt-in
  (`blockBackoff` defaults to `1`); values above `1` require `maxBlockDuration` to bound escalation.

  To support client keying, `@miiajs/core` gains `ctx.conn` (`ConnInfo` - lazy transport-level
  connection info) and `ctx.ip`, plus a `trustProxy: boolean | string | string[]` app option
  (leftmost `X-Forwarded-For`, a vendor header like `cf-connecting-ip`, or a priority list).
  `@miiajs/node-server` and `@miiajs/uws-server` populate the client address in both optimized
  and native modes. Core also adds `TooManyRequestsException` (429) and a `ip` option on
  `TestApp.request()` for faking the client address in tests.
