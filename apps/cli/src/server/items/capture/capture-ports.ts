// what a suite injects into the capture through `ComposePorts.items`: compose passes it through
// untouched, so every override is the capture's own to add.
export interface CapturePorts {
  // the fill's clock (its retry delays and a foreign stub's wait); unset, the wall clock
  // PIVOT-STUB(S1): gains the fetcher, lookup, address policy and fill runner overrides (§4.4)
  now?: () => number;
}
