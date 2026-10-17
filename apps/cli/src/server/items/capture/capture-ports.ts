// what a suite injects into the capture through `ComposePorts.items`: compose passes it through
// untouched, so every override is the capture's own to add. No override yet, spelled as a record
// of none because lint refuses an empty interface (no-empty-interface, no-empty-object-type).
// PIVOT-STUB(S1): becomes the interface of the fetcher, lookup, address policy, clock and fill
// runner overrides (§4.4)
export type CapturePorts = Record<string, never>;
