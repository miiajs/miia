---
'@miiajs/messaging': patch
---

Stop nesting dead-letter records in `InMemoryTransport`

A message that had already been dead-lettered and then failed again on its `<topic>.dlq` consumer was written to
`<topic>.dlq.dlq`, and so on for every level of DLQ consumer. It is now dropped with an error log instead, which
is what `@miiajs/messaging-redis` does - the default dev/test transport no longer disagrees with the one running
in production.

Detection is the `meta.lastError` marker the transport itself writes when it dead-letters a record, not the topic
name: an ordinary topic a user chose to call `billing.dlq` still dead-letters normally.
