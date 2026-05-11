// Polyfill Symbol.metadata for runtimes that don't support it natively.
// Must be imported before any decorator usage.
;(Symbol as any).metadata ??= Symbol.for('Symbol.metadata')
