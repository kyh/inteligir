// ---------------------------------------------------------------------------
// The ONE AppState → foreground/background mapping, shared by the host
// connection and the realtime sync stream. iOS's transient `inactive`
// (control center, app-switcher peek) is deliberately ignored — tearing
// connections down there would churn reconnects for a state that usually
// bounces straight back to `active`.
// ---------------------------------------------------------------------------

import { AppState } from "react-native";

export type ForegroundState = "active" | "background";

/** Subscribe to foreground/background transitions; returns unsubscribe. */
export function subscribeAppForeground(listener: (state: ForegroundState) => void): () => void {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") listener("active");
    else if (state === "background") listener("background");
  });
  return () => {
    subscription.remove();
  };
}
