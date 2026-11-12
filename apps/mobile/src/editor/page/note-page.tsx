"use dom";

// The phone's note: the editor every device draws, through its touch profile, in a web view of
// its own, Expo's DOM component. Its props are the whole wire (page-host.ts); outside this folder
// the phone draws natively.

import "./note-page.css";

import type { DOMProps } from "expo/dom";
import { useEffect, useState } from "react";
import { EditorProfileProvider } from "@repo/editor/editor-profile";
import { ItemEditor } from "@repo/editor/item/item-editor";
import { onLiveEditor } from "@repo/editor/live-editor";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { ThemeProvider } from "@repo/ui/lib/theme";

import { installPageHost } from "./page-host";
import type { PageProps } from "./page-host";
import { insertPagePolicy } from "./page-policy";

interface NotePageProps extends PageProps {
  readonly dom?: DOMProps;
}

// the page follows the phone's appearance, so there is no choice to keep
const keepSystemTheme = (): void => {
  /* empty */
};

const NotePage = (props: NotePageProps) => {
  const { focus, itemId } = props;
  // installed before the first render, since the editor's kits read the host as they render; the
  // policy first, so nothing the item names loads ahead of it. A dev build runs Metro's own scripts
  // from its server, which the policy would refuse.
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [host] = useState(() => {
    if (process.env.NODE_ENV === "production") {
      insertPagePolicy(props.cloudOrigin);
    }
    return installPageHost(props);
  });
  useEffect(() => {
    host.follow(props);
  });
  useEffect(() => {
    if (!focus) {
      return;
    }
    // a frame after the editor first answers, since it answers before Plate has drawn the text
    return onLiveEditor(itemId, (editor) => {
      requestAnimationFrame(() => {
        editor.tf.focus({ edge: "endEditor" });
      });
    });
  }, [focus, itemId]);
  return (
    <ThemeProvider theme="system" setTheme={keepSystemTheme}>
      <MotionPolicy>
        <TooltipProvider>
          <EditorProfileProvider profile="touch">
            <main
              data-editor-scroller=""
              className="isolate h-dvh overflow-y-auto bg-background pt-[env(safe-area-inset-top)] text-foreground antialiased"
            >
              <ItemEditor
                itemId={itemId}
                onNote={(note) => {
                  host.noteIs(note);
                }}
              />
            </main>
          </EditorProfileProvider>
          <ConfirmDialogHost />
          <Toaster position="top-center" />
        </TooltipProvider>
      </MotionPolicy>
    </ThemeProvider>
  );
};

export default NotePage;
