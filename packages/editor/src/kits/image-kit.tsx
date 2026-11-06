// An image in an item is a block the library holds (by its bytes' sha, or a web address). A
// picture file pasted or dropped into the text is not added to it: the editor takes the event, so
// the browser neither opens the file nor drops it as text, and says where a picture goes instead.

import { KEYS } from "platejs";
import { createPlatePlugin } from "platejs/react";

import { ImageElement } from "@repo/editor/nodes/image-node";
import { toast } from "@repo/ui/components/sonner";

/** @internal */
export const PICTURE_NOT_ADDED =
  "A picture isn't added to a note's text. Save it to your library as an item of its own, and link to it from the note.";

// what a paste's clipboard or a drop's drag hands over
interface Transfer {
  readonly files: Iterable<File>;
  readonly types: readonly string[];
}

// whether the editor takes the paste or the drop as a picture of the person's: a picture file, but
// not a browser's copy of a web picture, which also carries the page's own markup to paste
/** @internal */
export const takesPicture = (data: Transfer, from: "paste" | "drop"): boolean =>
  [...data.files].some((file) => file.type.startsWith("image/")) &&
  (from === "drop" || !data.types.includes("text/html"));

// a separate plugin on the base half's key (headless/image-base.ts): DOM paste/drop handlers exist
// only on React plugins.
export const ImageKit = [
  createPlatePlugin({
    key: KEYS.img,
    node: { isElement: true, isVoid: true },
  })
    .withComponent(ImageElement)
    .extend(() => ({
      handlers: {
        onDrop: ({ event }) => {
          if (!takesPicture(event.dataTransfer, "drop")) {
            return false;
          }
          event.preventDefault();
          toast.info(PICTURE_NOT_ADDED);
          return true;
        },
        onPaste: ({ event }) => {
          if (!takesPicture(event.clipboardData, "paste")) {
            return false;
          }
          event.preventDefault();
          toast.info(PICTURE_NOT_ADDED);
          return true;
        },
      },
    })),
];
