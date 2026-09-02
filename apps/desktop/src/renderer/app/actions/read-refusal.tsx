// A panel read the server refused. The lead names the surface; the server's
// own sentence follows when it carried one, because that is what names the
// thing the user can act on — the sidecar file, the path the vault refused.

import { refusalMessage } from "../api";

export function ReadRefusal({ lead, error }: { lead: string; error: unknown }) {
  const detail = refusalMessage(error, "");
  return (
    <div className="p-3 text-sm">
      <p className="text-destructive">{lead}</p>
      {detail === "" ? null : (
        <p className="mt-1 text-xs break-words text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}
