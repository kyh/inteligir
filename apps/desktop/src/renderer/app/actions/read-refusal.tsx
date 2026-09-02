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
