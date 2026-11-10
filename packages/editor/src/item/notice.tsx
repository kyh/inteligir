import { cn } from "@repo/ui/lib/cn";

import { editorColumnPx } from "@repo/editor/editor-chrome";
import type { EditorProfile } from "@repo/editor/editor-profile";

// why the text below takes no edit, held at the top of the scroll
export const Notice = ({ profile, text }: { profile: EditorProfile; text: string }) => (
  <div
    className={cn(
      editorColumnPx(profile),
      "sticky top-[env(safe-area-inset-top)] z-10 bg-background py-2 text-body",
    )}
  >
    <p className="text-muted-foreground">{text}</p>
  </div>
);
