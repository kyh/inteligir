import { createPlatePlugin } from "platejs/react";

import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";
import { toast } from "@repo/ui/components/sonner";

export const PASTE_MAX_BYTES = BODY_MAX_BYTES / 2;

export const PASTE_REFUSED =
  "That was too much to paste at once, so it wasn't added. A note holds about 1 MB.";

const pastedBytes = (data: DataTransfer) =>
  Math.max(0, ...data.types.map((type) => utf8ByteLength(data.getData(type))));

export const PasteCapPlugin = createPlatePlugin({ key: "pasteCap" }).overrideEditor(
  ({ tf: { insertData } }) => ({
    transforms: {
      insertData(data) {
        if (pastedBytes(data) > PASTE_MAX_BYTES) {
          toast.error(PASTE_REFUSED);

          return;
        }

        insertData(data);
      },
    },
  }),
);
