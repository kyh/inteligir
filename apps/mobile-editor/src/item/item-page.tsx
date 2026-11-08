// The page: one item's editor, by its id, over the library the phone reaches on the other end of
// the bridge. The page draws the item's blocks with the desktop's editor through the touch kit,
// writes what changed as ops after a pause, says why a write failed, only reads while the phone
// has no connection, and opens a linked item through the native stack.

import { StrictMode, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { EditorProfileProvider } from "@repo/editor/editor-profile";
import { ItemEditor } from "@repo/editor/item/item-editor";
import type { ItemSession, ItemSessionPorts } from "@repo/editor/item/item-session";
import { mergeConflictLine } from "@repo/editor/item/merge-conflict-line";
import type { ItemInit } from "@repo/editor-bridge/protocol";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster, toast } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { SizeProvider } from "@repo/ui/lib/size-context";
import { ThemeProvider } from "@repo/ui/lib/theme";

import type { PageBridge } from "../bridge/page-bridge";
import { bridgeItemStore, installItemPageHost } from "./item-host";
import type { PageConnection } from "./item-host";

const after = (ms: number, run: () => void): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

// the page follows the phone's appearance, so there is no choice to keep
const keepSystemTheme = (): void => {
  /* empty */
};

// what the native screen asks about before it lets the item go: why a write failed
const useEditorState = (bridge: PageBridge, session: ItemSession | null): void => {
  useEffect(() => {
    if (session === null) {
      return;
    }
    let last: string | null = null;
    const publish = (): void => {
      const status = session.status();
      const failure = status.kind === "open" ? status.failure : null;
      if (failure !== last) {
        last = failure;
        bridge.emit({ saveError: failure, type: "editorState" });
      }
    };
    return session.subscribe(publish);
  }, [bridge, session]);
};

export interface MountedPage {
  readonly unmount: () => void;
}

/** @internal */
export const ItemPage = ({
  bridge,
  connection,
  init,
  onSession,
  ports,
}: {
  bridge: PageBridge;
  connection: PageConnection;
  init: ItemInit;
  onSession: (session: ItemSession | null) => void;
  ports: ItemSessionPorts;
}) => {
  const [session, setSession] = useState<ItemSession | null>(null);
  useEditorState(bridge, session);
  const online = useSyncExternalStore(connection.subscribe, connection.online);
  return (
    <ThemeProvider theme="system" setTheme={keepSystemTheme}>
      <SizeProvider size="compact">
        <MotionPolicy>
          <TooltipProvider>
            <EditorProfileProvider profile="touch">
              <main
                data-editor-scroller=""
                className="h-dvh overflow-y-auto pt-[env(safe-area-inset-top)]"
              >
                <ItemEditor
                  itemId={init.itemId}
                  offline={!online}
                  ports={ports}
                  onSession={(next) => {
                    setSession(next);
                    onSession(next);
                  }}
                />
              </main>
            </EditorProfileProvider>
            <ConfirmDialogHost />
            <Toaster position="top-center" />
          </TooltipProvider>
        </MotionPolicy>
      </SizeProvider>
    </ThemeProvider>
  );
};

export const mountItemPage = ({
  bridge,
  container,
  init,
}: {
  bridge: PageBridge;
  container: Element;
  init: ItemInit;
}): MountedPage => {
  // installed before the first render: the editor's kits read the host as they render
  const host = installItemPageHost(bridge, init);
  const ports: ItemSessionPorts = {
    after,
    notifyOverlap: (title) => {
      toast.warning(mergeConflictLine(title));
    },
    store: bridgeItemStore(bridge),
  };
  const handleSession = (session: ItemSession | null): void => {
    host.attach(session);
  };
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ItemPage
        bridge={bridge}
        connection={host.connection}
        init={init}
        onSession={handleSession}
        ports={ports}
      />
    </StrictMode>,
  );
  return {
    unmount: () => {
      root.unmount();
      host.stop();
    },
  };
};
