// Pure tab-session semantics for the workspace tab strip — every transition
// the VaultProvider applies to its open-tab list lives here so the VS Code
// conventions (replace-active vs new-tab, close activates the right
// neighbor, cycle wraps) are unit-testable without React or controllers.
//
// Invariants every operation preserves:
// - `tabs` has no duplicate paths (a path is open in at most one tab).
// - `active` is a member of `tabs`, or null exactly when `tabs` is empty.

export type TabSession = {
  readonly tabs: readonly string[];
  readonly active: string | null;
};

export const EMPTY_SESSION: TabSession = { tabs: [], active: null };

/** How `openTab` places the path: `replace` swaps it into the active tab
 * slot (plain click — VS Code's open-in-current-tab), `new` appends a tab
 * after the active one (Cmd/Ctrl-click). Either way, a path that is already
 * open just activates its existing tab. */
export type OpenMode = "replace" | "new";

export function openTab(session: TabSession, path: string, mode: OpenMode): TabSession {
  if (session.tabs.includes(path)) return { tabs: session.tabs, active: path };
  if (mode === "replace" && session.active !== null) {
    const tabs = session.tabs.map((tab) => (tab === session.active ? path : tab));
    return { tabs, active: path };
  }
  const at =
    session.active === null ? session.tabs.length : session.tabs.indexOf(session.active) + 1;
  const tabs = [...session.tabs.slice(0, at), path, ...session.tabs.slice(at)];
  return { tabs, active: path };
}

/** Close a tab. Closing the active tab activates its right neighbor, falling
 * back to the left one (VS Code). Closing a background tab keeps the active. */
export function closeTab(session: TabSession, path: string): TabSession {
  const at = session.tabs.indexOf(path);
  if (at === -1) return session;
  const tabs = session.tabs.filter((tab) => tab !== path);
  if (tabs.length === 0) return EMPTY_SESSION;
  if (session.active !== path) return { tabs, active: session.active };
  const next = tabs[Math.min(at, tabs.length - 1)] ?? null;
  return { tabs, active: next };
}

export function activateTab(session: TabSession, path: string): TabSession {
  if (!session.tabs.includes(path) || session.active === path) return session;
  return { tabs: session.tabs, active: path };
}

/** Ctrl+Tab / Ctrl+Shift+Tab: cycle the active tab by `delta`, wrapping. */
export function cycleTab(session: TabSession, delta: 1 | -1): TabSession {
  if (session.tabs.length < 2 || session.active === null) return session;
  const at = session.tabs.indexOf(session.active);
  const next = session.tabs[(at + delta + session.tabs.length) % session.tabs.length];
  return next === undefined ? session : { tabs: session.tabs, active: next };
}

/** A file was renamed/moved — carry its tab (and active state) to the new
 * path in place. If the destination is somehow already open, the stale
 * source tab closes instead of duplicating. */
export function renameTab(session: TabSession, from: string, to: string): TabSession {
  if (!session.tabs.includes(from) || from === to) return session;
  if (session.tabs.includes(to)) {
    const closed = closeTab(session, from);
    return session.active === from ? { tabs: closed.tabs, active: to } : closed;
  }
  const tabs = session.tabs.map((tab) => (tab === from ? to : tab));
  return { tabs, active: session.active === from ? to : session.active };
}

/** Reorder: move the tab at `from` to index `to` (drag-reorder). */
export function moveTab(session: TabSession, from: number, to: number): TabSession {
  const path = session.tabs[from];
  if (path === undefined || from === to || to < 0 || to >= session.tabs.length) return session;
  const tabs = session.tabs.filter((_, i) => i !== from);
  tabs.splice(to, 0, path);
  return { tabs, active: session.active };
}

/** Most-recently-activated tab order — the pane host keeps one to decide
 * which tabs retain a live (mounted) editor across switches (#369). The
 * active path moves (or inserts) at the front; paths no longer open drop
 * out. Pure and identity-stable: returns `recency` itself when the update
 * is a no-op, so render-adjust callers can compare by reference. */
export function touchRecency(
  recency: readonly string[],
  tabs: readonly string[],
  active: string | null,
): readonly string[] {
  const kept = recency.filter((path) => tabs.includes(path));
  const next = active === null ? kept : [active, ...kept.filter((path) => path !== active)];
  const unchanged = next.length === recency.length && next.every((p, i) => p === recency[i]);
  return unchanged ? recency : next;
}

/** Parse a persisted ui-state value back into a session, dropping anything
 * malformed (unknown shape, duplicates, active not a member). */
export function parseSession(value: unknown): TabSession | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record: Record<string, unknown> = { ...value };
  const rawTabs = record["tabs"];
  const rawActive = record["active"];
  if (!Array.isArray(rawTabs)) return undefined;
  const tabs: string[] = [];
  for (const tab of rawTabs) {
    if (typeof tab !== "string" || tab === "" || tabs.includes(tab)) return undefined;
    tabs.push(tab);
  }
  if (tabs.length === 0) return EMPTY_SESSION;
  const active = typeof rawActive === "string" && tabs.includes(rawActive) ? rawActive : tabs[0];
  return active === undefined ? EMPTY_SESSION : { tabs, active };
}
