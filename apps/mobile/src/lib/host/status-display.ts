// ---------------------------------------------------------------------------
// Presentation mapping for the host-connection status — one place for the
// label + indicator-dot color every screen (Connect, Chat header, the vault
// screen's nav pill, the delegation badges) renders from. The dot classes are
// literal NativeWind class names IN THIS MODULE so the Tailwind scanner picks
// them up; consumers import the semantic constants, never a hex literal.
// ---------------------------------------------------------------------------

import type { HostSnapshot } from "./connection-core";

/** Background classes for a small round status dot. */
export const DOT_OK = "bg-[#22c55e]";
export const DOT_BUSY = "bg-[#f59e0b]";
export const DOT_ERROR = "bg-[#ef4444]";
export const DOT_IDLE = "bg-[#a3a3a3]";

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

/** Background class for a small round status dot. */
export function hostStatusDotClass(status: HostStatus): string {
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
