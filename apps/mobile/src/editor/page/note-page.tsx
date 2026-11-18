"use dom";

import "./zod-jitless";
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

// oxlint-disable-next-line no-empty-function -- the note page follows the system theme, which nothing here sets
const keepSystemTheme = () => {};

const NotePage = (props: NotePageProps) => {
  const { focus, itemId } = props;

  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [host] = useState(() => {
    if (process.env.NODE_ENV === "production") {
      insertPagePolicy();
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

    return onLiveEditor(itemId, (editor) => {
      editor.tf.focus({ edge: "endEditor" });
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
