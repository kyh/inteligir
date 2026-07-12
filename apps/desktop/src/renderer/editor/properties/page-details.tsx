// "Page details" — the shell-header affordance hosting the file-properties
// panel (it lives here rather than above the document). The popover resolves
// the live rich editor at open time (live-editor.ts); the panel inside edits
// the frontmatter NODE through that instance, so property writes ride the
// editor's normal serialize path to disk (see properties-node.ts).

import { useState } from "react";
import { InfoIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";

import { getLiveEditor } from "@renderer/editor/live-editor";
import { PropertiesPanel } from "@renderer/editor/properties/properties-panel";

/** The header renders this only while the rich editor is mounted (the same
 * rich-mode gate the inline panel lived behind), so the live-editor lookup
 * can only miss during a teardown race — then the popover renders empty. */
export function PageDetails({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const editor = open ? getLiveEditor(path) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Page details"
            title="Page details"
            className="size-7 px-0 text-muted-foreground hover:text-foreground"
          >
            <InfoIcon className="size-4" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-96 p-3">
        {editor !== null && <PropertiesPanel editor={editor} />}
      </PopoverContent>
    </Popover>
  );
}
