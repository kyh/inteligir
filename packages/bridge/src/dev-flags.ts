// ---------------------------------------------------------------------------
// Dev-flag gate (security hardening): whether the dev-only env switches
// (INTELIGIR_FAUX_AGENT, INTELIGIR_EMULATE_CONNECTORS, the explicit Google
// OAuth URL overrides) may be honored AT ALL. createHost() computes the bit
// ONCE from the injected HostPlatform (`!platform.isPackaged`) — a PACKAGED
// production build refuses the ambient env outright, so it can never be
// tricked into scripted-agent or fake-OAuth mode by its environment. The
// desktop main entry additionally refuses to START with a dev flag set in a
// packaged build (apps/desktop/src/main/index.ts) — belt and suspenders.
//
// Fail-closed: until boot decides, the answer is "not allowed" — bare test
// processes that exercise the flags opt in explicitly via setDevFlagsAllowed.
//
// Lives in @repo/bridge because BOTH flag consumers (@repo/agent's faux
// provider, @repo/connectors' emulate override) sit below @repo/server and
// already depend on bridge — hosting the bit here keeps it single-source
// without a connectors→agent edge. It is pure (no node imports), so
// bridge's iso constraint holds; only node-side hosts ever SET it.
// ---------------------------------------------------------------------------

let devFlagsAllowed = false;

/** Boot-time decision (createHost: `!platform.isPackaged`). Tests flip it
 * per case. */
export function setDevFlagsAllowed(allowed: boolean): void {
  devFlagsAllowed = allowed;
}

export function areDevFlagsAllowed(): boolean {
  return devFlagsAllowed;
}
