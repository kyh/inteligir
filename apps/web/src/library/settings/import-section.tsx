import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { Button } from "@repo/ui/components/button";
import { formatCount } from "@repo/ui/lib/plural";
import { useRef, useState } from "react";

import { useOnline } from "../cloud/needs-connection";
import { usePageLibrary } from "../cloud/library-context";
import { startImport, stopImport, useImportRun } from "../import/import-run";
import type { ImportRun } from "../import/import-run";
import { IMPORT_PICKS, IMPORT_SOURCES } from "../import/import-sources";
import type { ImportSource } from "../import/import-sources";
import { Row, SectionHeading } from "./settings-chrome";

export const importSentence = (run: Exclude<ImportRun, { kind: "idle" }>) => {
  switch (run.kind) {
    case "reading": {
      return "Reading the file…";
    }

    case "landing": {
      return `Added ${formatCount(run.counts.added)} of ${formatCount(run.total)}…`;
    }

    case "done": {
      const parts = [`Added ${formatCount(run.counts.added)}`];

      if (run.counts.alreadySaved > 0) {
        parts.push(`${formatCount(run.counts.alreadySaved)} already in the library`);
      }

      if (run.counts.unreadable > 0) {
        parts.push(`${formatCount(run.counts.unreadable)} couldn't be read`);
      }

      return `${parts.join(", ")}.`;
    }

    case "failed": {
      return run.message;
    }

    case "stopped": {
      return `Stopped after adding ${formatCount(run.counts.added)}.`;
    }

    default: {
      throw new Error(`unexpected ${String(run satisfies never)}`);
    }
  }
};

const ImportRow = () => {
  const { cloud } = usePageLibrary();
  const online = useOnline();
  const run = useImportRun();
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<ImportSource>("raindrop");
  const running = run.kind === "reading" || run.kind === "landing";

  return (
    <Row label="Import">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {IMPORT_SOURCES.map((option) => (
            <Button
              key={option}
              variant="secondary"
              disabled={running || !online}
              onClick={() => {
                setSource(option);

                if (pickerRef.current !== null) {
                  pickerRef.current.accept = IMPORT_PICKS[option].accept;
                  pickerRef.current.click();
                }
              }}
            >
              {IMPORT_PICKS[option].label}
            </Button>
          ))}
        </div>
        <input
          ref={pickerRef}
          type="file"
          hidden
          aria-label="The file to import"
          onChange={(event) => {
            const [file] = event.currentTarget.files ?? [];
            event.currentTarget.value = "";

            if (file !== undefined) {
              startImport({ file, source }, cloud.onSessionEnd);
            }
          }}
        />
        {online ? null : <p className="m-0 text-body text-muted-foreground">{NEEDS_CONNECTION}</p>}
        {run.kind === "idle" ? null : (
          <div className="flex items-center gap-2">
            <p className="m-0 text-body text-muted-foreground" data-import-state={run.kind}>
              {importSentence(run)}
            </p>
            {running ? (
              <Button variant="ghost" onClick={stopImport}>
                Stop
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </Row>
  );
};

export const ImportSection = () => (
  <section id="import" className="scroll-mt-10 space-y-2">
    <SectionHeading>Import</SectionHeading>
    <dl className="space-y-3">
      <ImportRow />
    </dl>
  </section>
);
