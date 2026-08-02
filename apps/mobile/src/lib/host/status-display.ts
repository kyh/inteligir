// ---------------------------------------------------------------------------
// Presentation mapping for the host-connection status — one place for the
// label + indicator-dot color every screen (Connect, Chat header, the vault
// screen's nav pill, the delegation badges) renders from. Consumers import the
// semantic constants, never a hex literal.
// ---------------------------------------------------------------------------

import type { HostSnapshot } from "./connection-core";

/** Fill colors for a small round status dot. */
export const DOT_OK = "#22c55e";
export const DOT_BUSY = "#f59e0b";
export const DOT_ERROR = "#ef4444";
export const DOT_IDLE = "#a3a3a3";

export type HostStatus = HostSnapshot["status"];

export function hostStatusLabel(status: HostStatus): string {
  switch (status) {
    case "none":
      return "Not connected";
    case "connecting":
      return "Connecting…";
    case "connected":
      return "Connected";
    case "disconnected":
      return "Reconnecting…";
    case "unauthorized":
      return "Not authorized";
  }
}

/** Fill color for a small round status dot. */
export function hostStatusDotColor(status: HostStatus): string {
  switch (status) {
    case "connected":
      return DOT_OK;
    case "connecting":
    case "disconnected":
      return DOT_BUSY;
    case "unauthorized":
      return DOT_ERROR;
    case "none":
      return DOT_IDLE;
  }
}
