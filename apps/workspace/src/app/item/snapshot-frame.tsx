// The kept copy of a saved page, framed by its own route by `src`, never a srcdoc: the route's
// policy sandboxes it with no script and data: alone, and a srcdoc would inherit the page's
// policy instead. The frame's own empty sandbox says the same a second time.

import { pageCopyUrl } from "@repo/contract/local/routes";

import type { MediaOrigin } from "../vault-hooks";

export const SnapshotFrame = ({ copy, media }: { copy: string; media: MediaOrigin }) => (
  <div data-item-stage="page-copy" className="flex min-h-0 flex-1">
    <iframe
      sandbox=""
      title="Copy of the page"
      src={pageCopyUrl(media.origin, copy, media.token)}
      className="h-full w-full border-0 bg-white"
    />
  </div>
);
