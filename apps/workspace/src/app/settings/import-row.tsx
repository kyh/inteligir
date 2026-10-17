// Settings › Library's way into a Raindrop import: the same chooser and dialog every other entry
// opens, mounted here because Settings draws over the workspace's own.

import { Button } from "@repo/ui/components/button";
import { useRef } from "react";

import { RaindropImport } from "../library/raindrop-import";
import type { RaindropImportHandle } from "../library/raindrop-import";
import { Row } from "./settings-chrome";

export const ImportRow = () => {
  const importRef = useRef<RaindropImportHandle | null>(null);
  return (
    <Row label="Import">
      <span className="flex flex-col items-start gap-1">
        <Button
          variant="tertiary"
          size="compact"
          onClick={() => {
            importRef.current?.choose();
          }}
        >
          Import from Raindrop…
        </Button>
        <span className="text-body text-muted-foreground">
          Choose the CSV file of a Raindrop backup. Its folders, tags and highlights come along.
        </span>
      </span>
      <RaindropImport handleRef={importRef} />
    </Row>
  );
};
