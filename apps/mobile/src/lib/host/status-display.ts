// ---------------------------------------------------------------------------
// Presentation mapping for the host-connection status — one place for the
// label + indicator-dot color every screen (Connect, Chat header, the vault
// screen's nav pill) renders from. The dot classes are literal NativeWind
// class names so the Tailwind scanner picks them up from this module.
// ---------------------------------------------------------------------------

import type { HostSnapshot } from "./connection-core";

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
      return "bg-[#22c55e]";
    case "connecting":
    case "disconnected":
      return "bg-[#f59e0b]";
    case "unauthorized":
      return "bg-[#ef4444]";
    case "none":
      return "bg-[#a3a3a3]";
  }
}
