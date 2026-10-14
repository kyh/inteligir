import { refusalMessage } from "../api";

export const ReadRefusal = ({ lead, error }: { lead: string; error: unknown }) => {
  const detail = refusalMessage(error, "");
  return (
    <div className="p-3 text-subtitle">
      <p className="text-destructive">{lead}</p>
      {detail === "" ? null : (
        <p className="mt-1 text-body break-words text-muted-foreground">{detail}</p>
      )}
    </div>
  );
};
