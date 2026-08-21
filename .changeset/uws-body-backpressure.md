---
'@miiajs/uws-server': minor
---

Apply backpressure to streamed request bodies, and add a `bodyHighWaterMark` option.

The stream path pushed every `res.onData` chunk into the controller unconditionally, and the stream
had no queuing strategy, so `desiredSize` counted chunks nobody looked at. A handler reading at its
own pace never held the client back - the body simply accumulated. The stream is now built with a
`ByteLengthQueuingStrategy`, the socket is paused with `res.pause()` once the queue passes the mark,
and the stream's `pull()` resumes it. The buffer path for small declared bodies is untouched:
`res.collectBody()` is bounded by `bufferThreshold` by construction.

Measured with a slow consumer (10 ms per MB, imitating an upload to remote storage), retained bytes
after a forced GC:

| body | before | after | `@miiajs/node-server` |
| --- | --- | --- | --- |
| 160 MB | +302 MB | +29 MB | +24 MB |
| 320 MB | +604 MB | +29 MB | +25 MB |
| 640 MB | +1201 MB | +28 MB | +25 MB |
| 1280 MB | +2404 MB | +33 MB | +25 MB |

Before the fix that is linear at roughly 1.88x the body size. After it, memory is flat and
independent of what the client sends: a 1.25 GB upload retains 33 MB, the same as a 160 MB one, and
lands where node-server does. A handler that reads flat out was never the problem and is unchanged -
under 20 MB at every size measured, before the fix as well as after. From the wire side, a handler
stalled at 1.1 MB now holds the client to 3.3 MB where it used to accept all 64 MB on offer, which
puts the adapter next to node-server at 2.2, Deno at 3.2 and Bun at 3.1.

A browser-style `FormData` upload, which declares a `Content-Length` and sends flat out, behaves the
same way - linear at about 1.96x before (+314/+630/+1254 MB at 160/320/640 MB), flat after - but
settles on a higher plateau, around 59 MB against the streaming client's 29. More bytes are in flight
when the pause fires, and uSockets hands over whatever it has already read. Plan capacity against the
higher figure.

`bodyHighWaterMark` (default `262144`, 256 KB) is how many bytes a streamed body may queue before
the pause. Measured at 64 KB, 256 KB and 1 MB it made no difference to throughput on one 160 MB
upload or on ten concurrent ones, so the default is the middle of a flat range rather than a tuned
peak; very small values only buy pause/resume churn. The pause is advisory and uSockets drains the
socket until `EWOULDBLOCK` inside one poll event, so the queue overshoots by whatever the client had
in flight - measured 1.4 MB after a pause that fired at 16 KB. Size capacity against
`bodyHighWaterMark` plus roughly 1.5 MB resident per in-flight upload.

The option belongs to `serve()` and is not reachable through `app.listen(port, serve)`, which passes
a closed set of options. Wrap the call to set it:

```ts
await app.listen(3000, (info) => serve({ ...info, bodyHighWaterMark: 1024 * 1024 }))
```

**Behaviour change.** Ending the response now disposes an unread request body: the stream is
**errored**, not closed, so a body read that was started and never awaited rejects where it used to
resolve. `@miiajs/core` caches exactly such a promise behind `ctx.json()`, so calling it without
awaiting and then responding produces an unhandled rejection instead of a value nobody reads. A body
cut off mid-flight must never look complete, which is why this errors rather than closing.

The disposal is what keeps the connection usable. A socket paused for backpressure and left paused
after the response wedges the keep-alive connection - measured, the follow-up request gets no
response at all. Ending with uWS's `closeConnection` flag is not the alternative: it races the
response onto the wire and loses it about a third of the time (measured `413 | 413 | EPIPE` across
three runs). So the remainder is resumed and discarded instead, which is bounded in memory but
unbounded in bytes read - 511.9 MB read and dropped in 190 ms after a 413, in the worst case
measured - with uWS's idle timeout as the only backstop. Those same bytes used to pile up in memory,
so it is strictly better, and no `Connection: close` is needed because the body still reaches its
end.
