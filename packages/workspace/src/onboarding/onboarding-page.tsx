import { useCallback, useEffect } from "react";

import { Button } from "@repo/ui/components/button";

import { InitialOrb } from "@repo/workspace/components/initial-orb";
import { getBridge } from "@repo/bridge/client";
import { useAgentStore } from "@repo/workspace/stores/agent-store";

export function OnboardingPage() {
  const appState = useAgentStore((s) => s.appState);
  const setupProgress = useAgentStore((s) => s.setupProgress);

  const setupError =
    appState.phase === "error" && appState.prev === "setting_up" ? appState.message : null;

  // `starting` is the client's own opening state, not something the host
  // reports: it holds until the connect's hydration push delivers a real
  // phase. SETUP asks for that phase directly, so a socket that came up after
  // the push is not stranded on the splash.
  //
  // Re-dispatched on an interval while it holds, because the dispatch rides the
  // socket: a one-shot fire-and-forget would leave the splash up until reload
  // if that single send failed transiently. SETUP is idempotent host-side, so
  // retrying needs no latch.
  useEffect(() => {
    if (appState.phase !== "starting") return;
    const dispatch = () => {
      void getBridge()
        .transition({ type: "SETUP" })
        .catch(() => {});
    };
    dispatch();
    const timer = setInterval(dispatch, 1500);
    return () => clearInterval(timer);
  }, [appState.phase]);

  // Same shape as the SETUP dispatch above: a rejection means the transition
  // never reached the host, the error text and this button stay put, and
  // pressing again IS the retry.
  const handleRetry = useCallback(() => {
    void getBridge()
      .transition({ type: "RETRY" })
      .catch(() => {});
  }, []);

  const label = setupProgress?.step ?? "Setting up...";
  const percent = setupProgress?.percent ?? null;
  const isIndeterminate = percent === null;

  return (
    <div className="flex flex-1 flex-col items-center justify-end px-6 pb-16">
      <InitialOrb />
      <div className="flex w-full max-w-xs flex-col gap-3 text-center">
        {setupError ? (
          <>
            <p className="text-[10px] text-destructive">{setupError}</p>
            <Button variant="ghost" size="sm" onClick={handleRetry} className="self-center">
              Retry
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{label}</p>
            {/* bg-muted ≈ canvas on the new ladder — the overlay tint keeps
                the track visible against the plain canvas. */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
              <div
                className={
                  isIndeterminate
                    ? "h-full w-full animate-progress-fill bg-foreground/60"
                    : "h-full bg-foreground/60 transition-[width] duration-200 ease-out"
                }
                style={isIndeterminate ? undefined : { width: `${String(percent)}%` }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
