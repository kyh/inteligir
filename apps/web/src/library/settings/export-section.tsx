import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { Button } from "@repo/ui/components/button";
import { formatCount, plural } from "@repo/ui/lib/plural";

import { usePageLibrary } from "../cloud/library-context";
import { useOnline } from "../cloud/needs-connection";
import { startExport, stopExport, useExportRun } from "../export/export-run";
import type { ExportRun } from "../export/export-run";
import { Row, SectionHeading } from "./settings-chrome";

export const exportSentence = (run: Exclude<ExportRun, { kind: "idle" }>) => {
  switch (run.kind) {
    case "listing": {
      return "Reading the library…" satisfies string;
    }

    case "writing": {
      return `Wrote ${formatCount(run.written)} of ${formatCount(run.total)}…` satisfies string;
    }

    case "done": {
      const parts = [`Wrote ${plural(run.counts.items, "item")}`];

      if (run.counts.propertiesLeftOut > 0) {
        parts.push(`${plural(run.counts.propertiesLeftOut, "property", "properties")} left out`);
      }

      if (run.counts.filesMissing > 0) {
        parts.push(`${plural(run.counts.filesMissing, "file")} couldn't be read`);
      }

      return `${parts.join(", ")}.` satisfies string;
    }

    case "failed": {
      return run.message satisfies string;
    }

    case "stopped": {
      return `Stopped after writing ${plural(run.written, "item")}, before the zip was finished.` satisfies string;
    }

    default: {
      throw new Error(`unexpected ${String(run satisfies never)}`);
    }
  }
};

const ExportRow = () => {
  const { cloud } = usePageLibrary();
  const online = useOnline();
  const run = useExportRun();
  const running = run.kind === "listing" || run.kind === "writing";

  return (
    <Row label="Export">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            disabled={running || !online}
            onClick={() => {
              void startExport(cloud.onSessionEnd);
            }}
          >
            Export the library…
          </Button>
        </div>
        <p className="m-0 text-body text-muted-foreground">
          Every item as a Markdown file, with the files it holds, which Import reads back.
        </p>
        {online ? null : <p className="m-0 text-body text-muted-foreground">{NEEDS_CONNECTION}</p>}
        {run.kind === "idle" ? null : (
          <div className="flex items-center gap-2">
            <p className="m-0 text-body text-muted-foreground" data-export-state={run.kind}>
              {exportSentence(run)}
            </p>
            {running ? (
              <Button variant="ghost" onClick={stopExport}>
                Stop
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </Row>
  );
};

export const ExportSection = () => (
  <section id="export" className="scroll-mt-10 space-y-2">
    <SectionHeading>Export</SectionHeading>
    <dl className="space-y-3">
      <ExportRow />
    </dl>
  </section>
);
