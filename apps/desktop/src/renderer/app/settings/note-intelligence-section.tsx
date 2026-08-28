// Settings → Note intelligence (#590): the switch for background frontmatter
// inference. The server owns the toggle (it is the process that spawns the
// inference children), so this section renders the server's own status and
// nothing it does not have. What the feature MAY write is stated beside the
// switch — description, tags, status, and only where a note lacks them —
// because a background writer earns its toggle by saying exactly what it
// touches.

import { Switch } from "@repo/ui/components/switch";
import type { NoteIntelligenceStatus } from "@repo/api/local/note-intelligence/note-intelligence-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "../api";
import { failed, Row, SectionHeading } from "./settings-chrome";

/** The reason this machine cannot infer, or null when it can. A sweep line of
 *  zeros would otherwise be the only thing an install without the CLI ever
 *  shows. */
function unavailableReason(status: NoteIntelligenceStatus): string | null {
  return status.availability.kind === "unavailable" ? status.availability.detail : null;
}

function sweepLine(status: NoteIntelligenceStatus): string {
  if (status.running) return "Sweeping…";
  if (status.lastSweep === null) return "No sweep yet.";
  const { scanned, updated, skipped } = status.lastSweep;
  return `Last sweep: ${String(scanned)} notes scanned, ${String(updated)} updated, ${String(skipped)} skipped.`;
}

export function NoteIntelligenceSection() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery(orpc.noteIntelligence.status.queryOptions());
  const status = statusQuery.data;
  const unavailable = status === undefined ? null : unavailableReason(status);

  const toggle = useMutation(
    orpc.noteIntelligence.toggle.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(orpc.noteIntelligence.status.queryKey(), next);
      },
      onError: (cause) => {
        failed(cause, "Could not change note intelligence.");
      },
    }),
  );

  return (
    <>
      <SectionHeading>Note intelligence</SectionHeading>
      <Row label="Infer note metadata">
        <Switch
          checked={status?.enabled ?? false}
          disabled={toggle.isPending || status === undefined || unavailable !== null}
          onCheckedChange={(enabled) => {
            toggle.mutate({ enabled });
          }}
          aria-label="Infer note metadata"
        />
      </Row>
      <p className="text-xs text-muted-foreground">
        Adds description, tags and status to notes that lack them, using the local Claude CLI with
        its cheapest model. Fields you set yourself are never rewritten.
      </p>
      {unavailable !== null ? <p className="text-xs text-destructive">{unavailable}</p> : null}
      {status === undefined || unavailable !== null ? null : (
        <p className="text-xs text-muted-foreground">{sweepLine(status)}</p>
      )}
    </>
  );
}
