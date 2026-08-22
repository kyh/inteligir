// Moss's persistent formatting toolbar: a bottom-center pill floating over
// the note (the selection toolbar still handles selection-scoped marks; this
// one is always there, for block-level moves). It lives OUTSIDE the Plate
// tree and acts through the live-editor registry — the same seam the page
// chrome uses — so mounting it can never remount the document.
//
// Deliberately stateless about the selection: active-state highlighting needs
// a Plate subscription this placement doesn't have, and a wrong highlight is
// worse than none. Moss's serif toggle is ABSENT for now: its persisted form
// is an HTML span whose exact shape must be verified against a real Moss note
// before this repo authors one (#584's stated deferral).

import { useState } from "react";
import {
  ChevronUpIcon,
  Code2Icon,
  HeadingIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MessageSquareQuoteIcon,
  MinusIcon,
  PanelsTopLeftIcon,
  PlusIcon,
  TextQuoteIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { cn } from "@repo/ui/lib/utils";

import { TURN_INTO, turnIntoSelection } from "@repo/editor/block-transforms";
import { insertTabGroup } from "@repo/editor/kits/tabs-kit";
import { getLiveEditor } from "@repo/editor/live-editor";

function option(label: string) {
  const found = TURN_INTO.find((opt) => opt.label === label);
  if (found === undefined) throw new Error(`TURN_INTO lost its "${label}" row`);
  return found;
}

function keepSelection(event: React.MouseEvent): void {
  event.preventDefault();
}

const BUTTON_CLASS =
  "flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4";

export function EditorBottomToolbar({ path }: { path: string }) {
  const [openMenu, setOpenMenu] = useState<"heading" | "insert" | null>(null);

  const apply = (label: string): void => {
    const editor = getLiveEditor(path);
    if (editor === null) return;
    turnIntoSelection(editor, option(label));
    editor.tf.focus();
  };

  const insert = (what: "divider" | "tabs"): void => {
    const editor = getLiveEditor(path);
    if (editor === null) return;
    if (what === "divider") {
      editor.tf.insertNodes({ children: [{ text: "" }], type: "hr" });
    } else {
      insertTabGroup(editor);
    }
    editor.tf.focus();
  };

  return (
    <div className="pointer-events-none sticky bottom-4 z-10 flex justify-center print:hidden">
      <div
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-background/95 px-2 py-1 shadow-md backdrop-blur"
        onMouseDown={keepSelection}
      >
        <DropdownMenu
          open={openMenu === "heading"}
          onOpenChange={(open) => {
            setOpenMenu(open ? "heading" : null);
          }}
        >
          <DropdownMenuTrigger
            className={cn(BUTTON_CLASS, "w-auto gap-0.5 px-1.5")}
            aria-label="Block type"
          >
            <HeadingIcon />
            <ChevronUpIcon className="!size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center">
            {["Text", "Heading 1", "Heading 2", "Heading 3"].map((label) => (
              <DropdownMenuItem
                key={label}
                onClick={() => {
                  apply(label);
                }}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="mx-0.5 h-4 w-px bg-border" />

        <button
          type="button"
          aria-label="Bulleted list"
          className={BUTTON_CLASS}
          onClick={() => {
            apply("Bulleted list");
          }}
        >
          <ListIcon />
        </button>
        <button
          type="button"
          aria-label="Numbered list"
          className={BUTTON_CLASS}
          onClick={() => {
            apply("Numbered list");
          }}
        >
          <ListOrderedIcon />
        </button>
        <button
          type="button"
          aria-label="To-do list"
          className={BUTTON_CLASS}
          onClick={() => {
            apply("To-do list");
          }}
        >
          <ListChecksIcon />
        </button>
        <button
          type="button"
          aria-label="Quote"
          className={BUTTON_CLASS}
          onClick={() => {
            apply("Quote");
          }}
        >
          <TextQuoteIcon />
        </button>

        <span className="mx-0.5 h-4 w-px bg-border" />

        <DropdownMenu
          open={openMenu === "insert"}
          onOpenChange={(open) => {
            setOpenMenu(open ? "insert" : null);
          }}
        >
          <DropdownMenuTrigger className={BUTTON_CLASS} aria-label="Insert block">
            <PlusIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center">
            <DropdownMenuItem
              onClick={() => {
                apply("Callout");
              }}
            >
              <MessageSquareQuoteIcon /> Callout
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                apply("Code block");
              }}
            >
              <Code2Icon /> Code block
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                insert("tabs");
              }}
            >
              <PanelsTopLeftIcon /> Tabs
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                insert("divider");
              }}
            >
              <MinusIcon /> Divider
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
