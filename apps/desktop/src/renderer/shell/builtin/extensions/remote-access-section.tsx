// Remote Access — pair the mobile app with this desktop through the relay.
//
// Opt-in and OFF by default: until the toggle is on, the desktop never opens
// a relay socket. Enabling mints a pairing credential shown here as one
// copyable string (`XXXX-XXXX-XXXX-XXXX.token`); the string is hidden until
// revealed because it is a bearer secret — anyone holding it can read the
// agent transcript and send commands. Rotate kills the old string instantly.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";
import { Switch } from "@repo/ui/components/switch";

import { getBridge } from "@/renderer/lib/bridge";
import { errorMessage, type SectionProps } from "@/renderer/shell/builtin/extensions/lib";
import type { DispatchState } from "@/shared/dispatch";
import { DISPATCH_INITIAL_STATE } from "@/shared/dispatch";

function statusLabel(state: DispatchState): { text: string; live: boolean } {
  switch (state.status) {
    case "off":
      return { text: "Off", live: false };
    case "connecting":
      return { text: "Connecting…", live: false };
    case "connected":
      return state.mobilePresent
        ? { text: "Phone connected", live: true }
        : { text: "Waiting for your phone", live: false };
    case "error":
      return { text: state.message, live: false };
  }
}

export function RemoteAccessSection({ onError }: SectionProps) {
  const [state, setState] = useState<DispatchState>(DISPATCH_INITIAL_STATE);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.getDispatchState().then(setState);
    return bridge.onDispatchState(setState);
  }, []);

  const enabled = state.status !== "off";

  const handleToggle = useCallback(async () => {
    setBusy(true);
    onError(null);
    try {
      const next = await getBridge()?.setRemoteAccess({ enabled: !enabled });
      if (next) setState(next);
      setRevealed(false);
      setCopied(false);
    } catch (err) {
      onError(errorMessage(err, "Failed to update Remote Access."));
    } finally {
      setBusy(false);
    }
  }, [enabled, onError]);

  const handleRotate = useCallback(async () => {
    setBusy(true);
    onError(null);
    try {
      const next = await getBridge()?.rotateDispatchCredential();
      if (next) setState(next);
      setRevealed(false);
      setCopied(false);
    } catch (err) {
      onError(errorMessage(err, "Failed to rotate the pairing string."));
    } finally {
      setBusy(false);
    }
  }, [onError]);

  const pairing = state.status === "off" ? null : state.pairing;

  const handleCopy = useCallback(async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("Couldn't copy to the clipboard.");
    }
  }, [pairing, onError]);

  const status = statusLabel(state);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">Remote Access</Label>
        <Switch
          label="Enable Remote Access"
          checked={enabled}
          onToggle={() => void handleToggle()}
          disabled={busy}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Pair the Inteligir mobile app to chat with this desktop from your phone. Off by default —
        nothing leaves this machine until you enable it.
      </p>

      {enabled && (
        <div className="flex flex-col gap-2 rounded-[12px] bg-muted px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                status.live
                  ? "bg-green-500"
                  : state.status === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground/50"
              }`}
            />
            <span
              className={`text-[10px] ${
                state.status === "error" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {status.text}
            </span>
          </div>

          {pairing && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">Pairing string</span>
              {revealed ? (
                <code className="rounded-[8px] bg-hover px-2 py-1 font-mono text-[10px] break-all select-all">
                  {pairing}
                </code>
              ) : (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="rounded-[8px] bg-hover px-2 py-1 text-left font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  ••••-••••-••••-••••.•••••• — click to reveal
                </button>
              )}
              <p className="text-[10px] text-muted-foreground/70">
                Enter this in the mobile app. Treat it like a password — anyone holding it can use
                your agent.
              </p>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopy()}
                  className="h-7 px-3 text-[10px]"
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRotate()}
                  disabled={busy}
                  className="h-7 px-3 text-[10px]"
                  title="Invalidate the current pairing string and mint a new one"
                >
                  Rotate
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
