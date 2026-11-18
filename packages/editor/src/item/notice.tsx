import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/cn";

import { editorColumnPx } from "@repo/editor/editor-chrome";
import type { EditorProfile } from "@repo/editor/editor-profile";

// what the text below says of itself, held at the top of the scroll, with what the person can do
// about it
export const Notice = ({
  profile,
  text,
  children,
}: {
  profile: EditorProfile;
  text: string;
  children?: ReactNode;
}) => (
  <div
    className={cn(
      editorColumnPx(profile),
      "sticky top-[env(safe-area-inset-top)] z-10 bg-background py-2 text-body",
    )}
  >
    <p className="text-muted-foreground">{text}</p>
    {children}
  </div>
);
