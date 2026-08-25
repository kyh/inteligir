// Settings → Note intelligence (#590): the switch for background frontmatter
// inference. The server owns the toggle (it is the process that spawns the
// inference children), so this section renders the server's own status and
// nothing it does not have. What the feature MAY write is stated beside the
// switch — description, tags, status, and only where a note lacks them —
// because a background writer earns its toggle by saying exactly what it
// touches.

import { Switch } from "@repo/ui/components/switch";
import type { NoteIntelligenceStatus } from "@repo/api/local/note-intelligence/note-intelligence-schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "../api";
import { useWorkspace } from "../workspace-context";
import { failed, Row, SectionHeading } from "./settings-chrome";

function sweepLine(status: NoteIntelligenceStatus): string {
  if (status.running) return "Sweeping…";
  if (status.lastSweep === null) return "No sweep yet.";
  const { scanned, updated, skipped } = status.lastSweep;
  return `Last sweep: ${String(scanned)} notes scanned, ${String(updated)} updated, ${String(skipped)} skipped.`;
}

export function NoteIntelligenceSection() {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const statusQuery = useQuery(orpc.noteIntelligence.status.queryOptions());
  const status = statusQuery.data;

  const setEnabled = (enabled: boolean): void => {
    void (async () => {
      setPending(true);
      try {
        const next = await api.noteIntelligence.toggle({ enabled });
        queryClient.setQueryData(orpc.noteIntelligence.status.queryKey(), next);
      } catch (cause) {
        failed(cause, "Could not change note intelligence.");
      } finally {
        setPending(false);
      }
    })();
  };

  return (
    <>
      <SectionHeading>Note intelligence</SectionHeading>
      <Row label="Infer note metadata">
        <Switch
          checked={status?.enabled ?? false}
          disabled={pending || status === undefined}
          onCheckedChange={setEnabled}
          aria-label="Infer note metadata"
        />
      </Row>
      <p className="text-xs text-muted-foreground">
        Adds description, tags and status to notes that lack them, using the local Claude CLI with
        its cheapest model. Fields you set yourself are never rewritten.
      </p>
      {status === undefined ? null : (
        <p className="text-xs text-muted-foreground">{sweepLine(status)}</p>
      )}
    </>
  );
}
