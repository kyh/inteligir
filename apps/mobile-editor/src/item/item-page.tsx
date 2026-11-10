// The page: one item, by its id, drawn from the blocks the phone holds of it with the desktop's
// editor through the touch kit, read-only under the phone's words for why, and drawn again as the
// item moves. A linked item opens through the native stack.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { EditorProfileProvider } from "@repo/editor/editor-profile";
import { HeldItem } from "@repo/editor/item/held-item";
import { MISSING_ITEM } from "@repo/editor/item/item-editor";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { SizeProvider } from "@repo/ui/lib/size-context";
import { ThemeProvider } from "@repo/ui/lib/theme";

import type { PageBridge } from "../bridge/page-bridge";
import { installItemPageHost, oneReadAtATime } from "./item-host";
import type { HeldItem as Held } from "./item-host";

/** @internal */
export const PHONE_READS_ONLY =
  "Editing on the phone is coming. For now, edit this note in a browser or on your Mac.";

// the page follows the phone's appearance, so there is no choice to keep
const keepSystemTheme = (): void => {
  /* empty */
};

type Shown =
  | { readonly kind: "reading" }
  | { readonly kind: "missing" }
  | { readonly kind: "unreachable" }
  // `read` counts the reads, so newer blocks draw in an editor of their own
  | { readonly kind: "held"; readonly item: Held; readonly read: number };

// the item as the phone holds it, read again each time the phone says it moved
const useHeldItem = (bridge: PageBridge, itemId: string): Shown => {
  const [shown, setShown] = useState<Shown>({ kind: "reading" });
  useEffect(() => {
    let reads = 0;
    let live = true;
    const read = oneReadAtATime(async () => {
      try {
        const { item } = await bridge.request("item", { itemId });
        reads += 1;
        const next: Shown =
          item === null ? { kind: "missing" } : { item, kind: "held", read: reads };
        if (live) {
          setShown(next);
        }
      } catch {
        if (live) {
          setShown((now) => (now.kind === "held" ? now : { kind: "unreachable" }));
        }
      }
    });
    void read();
    const stop = bridge.onNative((event) => {
      if (event.reset || event.ids.includes(itemId)) {
        void read();
      }
    });
    return () => {
      live = false;
      stop();
    };
  }, [bridge, itemId]);
  return shown;
};

const Words = ({ text }: { text: string }) => (
  <p className="px-4 pt-4 text-body text-muted-foreground">{text}</p>
);

const ItemBody = ({ bridge, itemId }: { bridge: PageBridge; itemId: string }) => {
  const shown = useHeldItem(bridge, itemId);
  switch (shown.kind) {
    case "reading": {
      return null;
    }
    case "missing": {
      return <Words text={MISSING_ITEM} />;
    }
    case "unreachable": {
      return <Words text={NEEDS_CONNECTION} />;
    }
    case "held": {
      return (
        <HeldItem
          key={shown.read}
          itemId={itemId}
          blocks={shown.item.blocks.map(({ block }) => block)}
          notice={PHONE_READS_ONLY}
        />
      );
    }
    // no default
  }
};

export interface MountedPage {
  readonly unmount: () => void;
}

const ItemPage = ({ bridge, itemId }: { bridge: PageBridge; itemId: string }) => (
  <ThemeProvider theme="system" setTheme={keepSystemTheme}>
    <SizeProvider size="compact">
      <MotionPolicy>
        <TooltipProvider>
          <EditorProfileProvider profile="touch">
            <main
              data-editor-scroller=""
              className="h-dvh overflow-y-auto pt-[env(safe-area-inset-top)]"
            >
              <ItemBody bridge={bridge} itemId={itemId} />
            </main>
          </EditorProfileProvider>
          <ConfirmDialogHost />
          <Toaster position="top-center" />
        </TooltipProvider>
      </MotionPolicy>
    </SizeProvider>
  </ThemeProvider>
);

export const mountItemPage = ({
  bridge,
  container,
  itemId,
}: {
  bridge: PageBridge;
  container: Element;
  itemId: string;
}): MountedPage => {
  // installed before the first render: the editor's kits read the host as they render
  const host = installItemPageHost(bridge, itemId);
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ItemPage bridge={bridge} itemId={itemId} />
    </StrictMode>,
  );
  return {
    unmount: () => {
      root.unmount();
      host.stop();
    },
  };
};
