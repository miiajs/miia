# @miiajs/messaging-redis

> ⚠️ **Experimental** - the API surface is stable, but the package has not been validated under production load. The `XAUTOCLAIM` crash-recovery path is covered by `it.todo`, not real exercise. Track promotion to `beta` on the [roadmap](https://miiajs.com/docs/roadmap).

Redis Streams transport for `@miiajs/messaging` - consumer groups, exponential backoff retry via ZSET, auto-DLQ, idempotency store.

## Installation

```bash
npm install @miiajs/messaging @miiajs/messaging-redis ioredis
```

## Documentation

**[miiajs.com/docs/packages/messaging/redis](https://miiajs.com/docs/packages/messaging/redis)**

## License

MIT
