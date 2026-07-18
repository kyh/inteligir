// ---------------------------------------------------------------------------
// HTML-App view — renders a vault `.html` file as a sandboxed app. The iframe
// is `sandbox="allow-scripts allow-forms"` with NO allow-same-origin, so the
// app gets an opaque origin and can NEVER reach the parent's Bridge (or its
// `window.bridgeBootstrap` ws token) or the parent DOM. Its only channel to the vault is postMessage to this parent,
// brokered (validated + confined) by html-app-broker.
//
// Two URL strategies:
//   • Electron — the vault-app:// protocol serves the file (with the runtime
//     injected main-side) at a per-open token URL; the frame's `name` carries
//     the token so the broker can authenticate messages.
//   • Harness (plain browser) — no protocol, so we read the bytes over the
//     fixture Bridge, inject the SAME runtime, and load a blob: URL. The broker
//     is identical either way (parent-window postMessage).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCwIcon, FileTextIcon } from "lucide-react";

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";

import { injectHtmlAppRuntime } from "@/html-app-inject";
import { getBridge } from "@renderer/lib/bridge";
import { handleBrokerRequest } from "@renderer/workspace/html-app-broker";
import { useVault } from "@renderer/workspace/vault-context";
import { basenamePath } from "@repo/core/knowledge/vault-path";
import { toErrorMessage } from "@repo/features/ipc";

// The postMessage request envelope the runtime sends. Validated before dispatch.
const RequestEnvelope = Type.Object(
  {
    type: Type.Literal("inteligir:request"),
    id: Type.String(),
    token: Type.String(),
    method: Type.String(),
    args: Type.Array(Type.Unknown()),
  },
  { additionalProperties: false },
);

function encodeVaultPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function isElectronHost(): boolean {
  return typeof window.bridgeBootstrap !== "undefined";
}

export function HtmlAppView() {
  const { openPath, openFile, showHtmlAsText } = useVault();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The per-open token — minted ONCE per open (not per reload), mirrored onto
  // the frame `name`; the broker only trusts messages carrying this exact token
  // from this exact frame. The ref is what the broker reads synchronously.
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<string>("");
  // Last-seen file text, so a vault change only reloads when THIS app changed
  // (onVaultChanged fires for any vault edit, and carries no path).
  const lastTextRef = useRef<string | null>(null);

  const fileName = openPath === null ? "" : basenamePath(openPath);

  // Mint the token once per open. Re-minting on every reload raced the
  // remount (a blank frame): the token is stable for the lifetime of the open.
  // On close/unmount (dep change or teardown), revoke it — the FIFO bound in
  // vault-app-protocol.ts is only a backstop for tokens whose view never got
  // the chance to revoke (crash, hard reload).
  useEffect(() => {
    if (openPath === null) return;
    const bridge = getBridge();
    if (!bridge) {
      setError("No bridge available.");
      return;
    }
    let cancelled = false;
    let mintedToken: string | null = null;
    void (async () => {
      try {
        const minted = await bridge.mintHtmlAppToken();
        if (cancelled) return;
        mintedToken = minted;
        tokenRef.current = minted;
        setToken(minted);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
      if (mintedToken !== null) void bridge.revokeHtmlAppToken({ token: mintedToken });
    };
  }, [openPath]);

  // Build the iframe source. Electron: a stable vault-app:// URL (the protocol
  // re-serves fresh bytes on each load — reload is just the `key` remount).
  // Harness: a blob URL rebuilt from the file bytes, so `reloadKey` re-fetches.
  useEffect(() => {
    if (openPath === null || token === null) return;
    if (isElectronHost()) {
      setSrc(`vault-app://app/${encodeVaultPath(openPath)}?token=${token}`);
      return;
    }
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const html = injectHtmlAppRuntime(await bridge.readVaultDoc({ path: openPath }));
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        setSrc(objectUrl);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [openPath, token, reloadKey]);

  // Hot reload: on any vault change, re-read the file and bump only if the app's
  // bytes actually changed (agent edit, on-disk edit, sync).
  useEffect(() => {
    if (openPath === null) return;
    const bridge = getBridge();
    if (!bridge) return;
    lastTextRef.current = null;
    const unsubscribe = bridge.onVaultChanged(() => {
      void (async () => {
        try {
          const text = await bridge.readVaultDoc({ path: openPath });
          if (lastTextRef.current !== null && lastTextRef.current !== text) {
            setReloadKey((k) => k + 1);
          }
          lastTextRef.current = text;
        } catch {
          // File vanished — leave the current render; the vault watcher/editor
          // handles the missing-file case elsewhere.
        }
      })();
    });
    // Seed the baseline so the first real change is detected.
    void (async () => {
      try {
        lastTextRef.current = await bridge.readVaultDoc({ path: openPath });
      } catch {
        // File missing at open — leave the baseline null.
      }
    })();
    return unsubscribe;
  }, [openPath]);

  const confirmRemove = useCallback(
    (path: string) =>
      confirm({
        title: `Delete ${path}?`,
        body: "This permanently deletes the file from your vault.",
        confirmLabel: "Delete",
        destructive: true,
      }),
    [],
  );

  // Broker: validate the envelope + frame + token, dispatch, post the response.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    const onMessage = (event: MessageEvent): void => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return; // wrong frame
      if (!Value.Check(RequestEnvelope, event.data)) return; // not our envelope
      const msg = event.data;
      if (msg.token !== tokenRef.current) return; // stale / spoofed token
      void (async () => {
        const reply = (payload: object): void =>
          frame.contentWindow?.postMessage(
            { type: "inteligir:response", id: msg.id, ...payload },
            "*",
          );
        try {
          const value = await handleBrokerRequest(msg.method, msg.args, {
            bridge,
            openFile,
            confirmRemove,
          });
          reply({ ok: true, value });
        } catch (err) {
          reply({ ok: false, error: toErrorMessage(err) });
        }
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [openFile, confirmRemove]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="truncate text-xs font-medium text-muted-foreground" title={openPath ?? ""}>
          {fileName}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCwIcon className="size-3" />
            Reload
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-xs"
            onClick={showHtmlAsText}
          >
            <FileTextIcon className="size-3" />
            Open as text
          </Button>
        </div>
      </div>
      {error !== null ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-destructive">
          {error}
        </div>
      ) : src === null ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Loading app…
        </div>
      ) : (
        <iframe
          key={reloadKey}
          ref={iframeRef}
          name={token ?? ""}
          src={src}
          title={fileName}
          // NO allow-same-origin — the app must never reach the host bridge.
          sandbox="allow-scripts allow-forms"
          className="min-h-0 w-full flex-1 border-0 bg-background"
        />
      )}
    </div>
  );
}
