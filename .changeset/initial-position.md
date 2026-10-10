---
'@miiajs/messaging': minor
'@miiajs/messaging-redis': minor
---

Add `initialPosition` to choose where a new subscription starts reading

A consumer group created after entries were published never saw them: every group started at the end of the topic,
so a message published before a worker's first start, or before a new handler was deployed, was not delivered. That
stays the default, and it is now a choice per handler with a written contract.

`@On(topic, { initialPosition })` sets it per handler, `MessagingModule.configure({ initialPosition })` sets a bus
default. Values:

- `'latest'` - only entries published after the group is created. Default, no behaviour change.
- `'earliest'` - everything the broker still retains for the topic.
- `{ since: ms }` - entries from the last `since` milliseconds, plus everything after. `since` must be a positive
  integer.

The position applies only when the broker-side group is created for the first time; an existing group is never moved.
Broadcast handlers always start at `'latest'` - the bus default does not reach them, and an explicit `'earliest'` or
`{ since }` on one throws at startup. Handlers on one bus that share an explicit `group` must resolve to the same
position, or startup throws.

**Transport contract.** `MessageTransport` gains an optional `supportedInitialPositions`, validated at startup like
`supportedModes`. A transport that does not declare it supports `'latest'` only, so a handler asking for more fails at
startup instead of silently starting at the end. `InMemoryTransport` declares all three - it retains nothing, so each
means "from now".

**Redis.** `XGROUP CREATE` starts at `$` for `'latest'`, `0` for `'earliest'`, and `<TIME - since>-0` for a window,
measured on the Redis clock (the process clock only when `TIME` is denied, with one warning). Creating a group now logs
`Created consumer group <group> on <topic> at <id>`.
