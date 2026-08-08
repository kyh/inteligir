// ---------------------------------------------------------------------------
// HTML-App view — renders a vault `.html` file as a sandboxed app. The iframe
// is `sandbox="allow-scripts allow-forms"` with NO allow-same-origin, so the
// app gets an opaque origin and can NEVER reach the parent's Bridge or the
// parent DOM. Its only channel to the vault is postMessage to this parent,
// brokered (validated + confined) by html-app-broker.
//
// The bytes are read over the Bridge, the runtime is injected here, and the
// result loads as a `blob:` URL. The per-open token rides the frame's `name`
// so the broker can tell this frame's messages from anything else on the page;
// the frame learns it only because we put it there, which is what makes it a
// capability handle rather than a secret.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { RefreshCwIcon, FileTextIcon } from "lucide-react";

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { Button } from "@repo/ui/components/button";

import { confirmVaultDelete } from "@repo/workspace/components/confirm-vault-delete";
import { getBridge } from "@repo/bridge/client";
import { vaultChangeTouches } from "@repo/bridge/vault";
import { handleBrokerRequest } from "@repo/workspace/workspace/html-app-broker";
import { openDocPath } from "@repo/editor/note/open-doc";
import { htmlAppRuntime } from "@repo/workspace/workspace/html-app-host";
import { useOpenNote } from "@repo/editor/note/open-note-store";
import { useVaultActions } from "@repo/editor/host";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { toErrorMessage } from "@repo/bridge/wire-helpers";

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

export function HtmlAppView() {
  const { openFile, showHtmlAsText } = useVaultActions();
  const openPath = useOpenNote((s) => openDocPath(s.openDoc));
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The per-open token — minted ONCE per open (not per reload), mirrored onto
  // the frame `name`; the broker only trusts messages carrying this exact token
  // from this exact frame. The ref is what the broker reads synchronously.
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<string>("");

  // Last-seen file text, so a change the host could not describe still only
  // reloads when this app's own bytes moved.
  const lastTextRef = useRef<string | null>(null);

  const fileName = openPath === null ? "" : basenamePath(openPath);

  // Mint the token once per open. Re-minting on every reload raced the
  // remount (a blank frame): the token is stable for the lifetime of the open.
  useEffect(() => {
    if (openPath === null) return;
    const minted = crypto.randomUUID();
    tokenRef.current = minted;
    setToken(minted);
    setError(null);
  }, [openPath]);

  // Build the iframe source: a blob URL rebuilt from the file bytes, so
  // `reloadKey` re-fetches.
  useEffect(() => {
    if (openPath === null || token === null) return;
    const { injectRuntime } = htmlAppRuntime();
    const bridge = getBridge();
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const html = injectRuntime(await bridge.readVaultDoc({ path: openPath }));
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

  // Hot reload: on a change that reached THIS file, re-read it and bump only if
  // its bytes actually changed (agent edit, on-disk edit, sync).
  useEffect(() => {
    if (openPath === null) return;
    const bridge = getBridge();
    lastTextRef.current = null;
    const unsubscribe = bridge.onVaultChanged((event) => {
      if (!vaultChangeTouches(event, openPath)) return;
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

  // Broker: validate the envelope + frame + token, dispatch, post the response.
  useEffect(() => {
    const bridge = getBridge();
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
            confirmRemove: confirmVaultDelete,
          });
          reply({ ok: true, value });
        } catch (err) {
          reply({ ok: false, error: toErrorMessage(err) });
        }
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [openFile]);

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
