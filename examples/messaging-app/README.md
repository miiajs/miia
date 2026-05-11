# messaging-app

Two-bus event-driven example for `@miiajs/messaging` and `@miiajs/messaging-redis`.

Demonstrates:

- **Two named buses** in a single app:
  - default bus → `inMemoryTransport` (fast, in-process, ephemeral)
  - `'redis'` bus → `redisStreamsTransport` (durable, cross-process)
- `@On(topic)` vs `@On(topic, { bus: 'redis' })` routing
- **Consumer groups**: `order.placed` is fan-out to two groups (`analytics`, `inventory`) - each group processes independently, identical `group` name across replicas would load-balance
- **`@Idempotent` deduplication** with both `MemoryIdempotencyStore` and `RedisIdempotencyStore`
- **Retry with exponential backoff** (`maxAttempts: 2, backoffMs: 500, multiplier: 2`)
- **Dead-letter queue** - `payment.charge` always throws → exhausts retries → re-published to `payment.charge.dlq` with `meta.lastError` populated
- DLQ consumer that records failures
- Per-handler `concurrency` (`order.placed/analytics` uses `concurrency: 4`)
- W3C `traceparent` propagation via `bus.publish(..., { traceparent })`

## Topology

```
HTTP layer (Miia)
  POST /orders                     ─┐
  POST /orders/duplicate-notification├─ OrdersController → OrdersService
  POST /orders/charge               ─┘                       │
  GET  /orders/stats                                          │
                                                              ▼
                                ┌─────────────────────────────┴─────────────┐
                                ▼                                           ▼
                       memory bus (default)                          redis bus ('redis')
                       ├─ notification.send                          ├─ order.placed (group=analytics, concurrency=4)
                       │   └─ NotificationHandler                    ├─ order.placed (group=inventory, @Idempotent on Redis)
                       │       (@Idempotent on Memory)               ├─ payment.charge (group=payments, ALWAYS fails)
                       └─ MemoryIdempotencyStore                     │   └─ FlakyPaymentHandler ⤵
                                                                     ├─ payment.charge.dlq (group=payments-dlq)
                                                                     │   └─ PaymentDlqHandler
                                                                     └─ RedisIdempotencyStore (key prefix `messaging-app:idem:`)
```

## Setup

Start Redis:

```sh
docker compose up -d
```

Create `.env` (the `.env.example` placeholder is blocked from auto-generation - copy-paste this):

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
REDIS_URL=redis://localhost:6379
```

Install and run:

```sh
bun install
bun run dev
```

You should see two `MessageBus` startup logs - one for the default bus, one for `MessageBus:redis` - and one transport subscription per `@On` handler.

## Walkthroughs

### 1. Place an order (both buses fire)

```sh
curl -s -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{
    "customerEmail": "alice@example.com",
    "total": 199.99,
    "items": [{"sku":"WIDGET-1","qty":2},{"sku":"GADGET-9","qty":1}]
  }' | jq
```

Server logs (abbreviated):

```
[NotificationHandler] [memory] sending 'order-confirmation' to alice@example.com (order ...)
[OrderAnalyticsHandler] [redis/analytics] recorded order ... ($199.99); totals: 1 orders / $199.99
[OrderInventoryHandler] [redis/inventory] reserving stock for order ...: WIDGET-1×2, GADGET-9×1
```

`order.placed` was published to **Redis Streams**, fanned out to two consumer groups - both ran. `notification.send` stayed in-process on the memory bus.

### 2. Idempotency (memory bus)

```sh
curl -s -X POST http://localhost:3000/orders/duplicate-notification \
  -H 'content-type: application/json' \
  -d '{"orderId":"order-42","customerEmail":"alice@example.com"}' | jq
```

Server emits the `notification.send` event twice with identical `orderId`. The handler's `@Idempotent({ key: p => 'notification:' + p.orderId })` claims `notification:order-42` on the first delivery; the second is silently skipped. You see exactly **one** `[memory] sent confirmation` log line.

### 3. Retry → DLQ (redis bus)

```sh
curl -s -X POST http://localhost:3000/orders/charge \
  -H 'content-type: application/json' \
  -d '{"orderId":"order-42","amount":50}' | jq
```

`FlakyPaymentHandler` throws on every attempt. Configured `maxAttempts: 2, backoffMs: 500, multiplier: 2`, so:

```
attempt #1  → throws → ZSET retry (delay 500ms)
attempt #2  → throws → ZSET retry (delay 1000ms)
attempt #3  → throws → exhausted → republished to payment.charge.dlq
PaymentDlqHandler [redis/dlq] payment ... exhausted retries: Payment gateway unreachable...
```

### 4. Inspect aggregated state

```sh
curl -s http://localhost:3000/orders/stats | jq
```

Returns analytics counters from `OrderAnalyticsHandler` plus the recorded DLQ failures from `PaymentDlqHandler`.

### 5. Inspect Redis directly

```sh
docker exec -it messaging-app-redis redis-cli

> KEYS *
1) "miia:stream:order.placed"
2) "miia:retry:payment.charge"
3) "miia:stream:payment.charge.dlq"
4) "messaging-app:idem:inventory:..."

> XINFO STREAM miia:stream:order.placed
> XINFO GROUPS miia:stream:order.placed     # see analytics + inventory
> XLEN miia:stream:payment.charge.dlq       # count of dead-lettered payments
> ZRANGE miia:retry:payment.charge 0 -1 WITHSCORES   # pending retries with delivery timestamps
```

## File layout

```
src/
  main.ts                              - Miia bootstrap, reads PORT/HOST from ConfigService
  env.schema.ts                        - Zod env schema (NODE_ENV, HOST, PORT, REDIS_URL)
  app/
    app.module.ts                      - root module: ConfigModule + 2× MessagingModule + OrdersModule
    app.controller.ts                  - GET / hello sanity check
    app.service.ts
  orders/
    orders.module.ts
    orders.controller.ts               - HTTP endpoints
    orders.service.ts                  - publishes to both buses
    events.ts                          - payload types + topic constants
    handlers/
      notification.handler.ts          - default bus, @Idempotent, MemoryIdempotencyStore
      order-analytics.handler.ts       - redis bus, group='analytics', concurrency=4
      order-inventory.handler.ts       - redis bus, group='inventory', @Idempotent (Redis store)
      flaky-payment.handler.ts         - redis bus, throws every time → drives retry/DLQ
      payment-dlq.handler.ts           - redis bus, listens on payment.charge.dlq
```

## Notes

- `MessagingModule.configure(opts, 'redis')` registers a **named** bus. Inject it via
  `inject<MessageBus>(getMessageBusToken('redis') as string)` (see `orders.service.ts`).
- The default bus is injected as `inject(MessageBus)` - same pattern as a single-bus app.
- DLQ topic is automatic: any topic `t` produces `<t>.dlq` after `maxAttempts` failures (when `dlq: true`).
- Retry config is **per transport**, not per topic - two buses with different `maxAttempts` here illustrate that.
- `RedisIdempotencyStore` uses `SET NX EX`; safe across processes. Key prefix is configured to `messaging-app:idem:` to avoid collisions if multiple services share the Redis instance.
- **Connection model** of `redisStreamsTransport`: 1 publisher client + 1 duplicated subClient per `subscribe()` call. In this example the transport opens `1 + 4 = 5` Redis connections; the separately-configured `redisIdempotencyStore` adds one more (its own client), so `redis-cli CLIENT LIST` shows **6** connections from the app process.
- `blockMs` is a Redis idle-traffic / shutdown-responsiveness knob, not a publish-latency one. Publish latency stays at ~RTT regardless of how many blocking subscribers exist - per-subscribe duplicates isolate `XREADGROUP BLOCK` from `XADD`.
