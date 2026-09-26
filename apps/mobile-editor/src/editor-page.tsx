import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { EditorColumn } from "@repo/editor/editor-column";
import { EditorProfileProvider } from "@repo/editor/editor-profile";
import { setEditorHostIo } from "@repo/editor/host-io";
import { focusNoteBody } from "@repo/editor/note-body-focus";
import { focusNoteTitle } from "@repo/editor/note-title-focus";
import { OpenNoteStoreProvider, useOpenNote } from "@repo/editor/note/open-note-context";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { RadiusProvider } from "@repo/ui/lib/radius-context";
import { SizeProvider } from "@repo/ui/lib/size-context";
import { ThemeProvider } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";

import type { PageBridge } from "./bridge/page-bridge";
import type { PageInit } from "./bridge/protocol";
import { createPageHost } from "./host/page-host";

// Mounted after the column, so the note's own title and body have registered their focus by the
// time this effect runs; a frame later, so the body's editable is in the document.
const FocusOnOpen = ({ focus, path }: { focus: PageInit["focus"]; path: string }) => {
  const shown = useOpenNote(
    (state) =>
      (state.openDoc.kind === "markdown" || state.openDoc.kind === "non-markdown") &&
      state.openDoc.path === path,
  );
  useEffect(() => {
    if (!shown || focus === null) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (focus === "title") {
        focusNoteTitle(path);
      } else {
        focusNoteBody(path);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [shown, focus, path]);
  return null;
};

// Nothing draws until the note is open: the column's empty state speaks to a desktop with a rail
// to pick from, and the phone's native screen is that rail.
const PhoneColumn = () => {
  const open = useOpenNote((state) => state.openDoc.kind !== "none");
  return open ? <EditorColumn /> : null;
};

export const EditorPage = ({
  bridge,
  init,
  store,
}: {
  bridge: PageBridge;
  init: PageInit;
  store: OpenNoteStore;
}) => {
  const [theme, setTheme] = useState<Theme>(init.theme);
  useEffect(
    () =>
      bridge.onNative((event) => {
        if (event.type === "theme") {
          setTheme(event.theme);
        }
      }),
    [bridge],
  );

  return (
    <ThemeProvider theme={theme} setTheme={setTheme}>
      <RadiusProvider radius="rounded">
        <SizeProvider size="compact">
          <MotionPolicy>
            <TooltipProvider>
              <OpenNoteStoreProvider store={store}>
                <EditorProfileProvider profile="touch">
                  <main
                    data-editor-scroller=""
                    className="h-dvh overflow-y-auto pt-[env(safe-area-inset-top)]"
                  >
                    <PhoneColumn />
                  </main>
                  <FocusOnOpen focus={init.focus} path={init.path} />
                </EditorProfileProvider>
              </OpenNoteStoreProvider>
              <ConfirmDialogHost />
              <Toaster position="top-center" />
            </TooltipProvider>
          </MotionPolicy>
        </SizeProvider>
      </RadiusProvider>
    </ThemeProvider>
  );
};

export interface MountedPage {
  readonly unmount: () => void;
}

export const mountEditorPage = ({
  bridge,
  container,
  init,
}: {
  bridge: PageBridge;
  container: Element;
  init: PageInit;
}): MountedPage => {
  const store = createOpenNoteStore();
  const host = createPageHost({ bridge, path: init.path, store });
  // before the first render: the note the boot opens mounts hooks that read the host as they render
  setEditorHostIo(host.io);
  host.start();
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <EditorPage bridge={bridge} init={init} store={store} />
    </StrictMode>,
  );
  return {
    unmount: () => {
      root.unmount();
      host.stop();
    },
  };
};
