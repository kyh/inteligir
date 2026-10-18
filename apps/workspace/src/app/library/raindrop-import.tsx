// The way into a Raindrop import from anywhere that offers it (Settings, ⌘P, "+ Add", the empty
// library): a hidden file field, the server's plan of what the backup would add, and the dialog
// that confirms it. Nothing is written before Import is pressed; the server runs the job, and the
// rail's footer says how it goes.

import type { ImportsPlanResponse } from "@repo/contract/local/imports/imports-schema";
import { toast } from "@repo/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useImperativeHandle, useRef, useState } from "react";
import type { RefObject } from "react";

import { client, failed, isDefinedError, orpc, refusalMessage, safe } from "../api";
import { ImportDialog } from "../import/import-dialog";

export const UNREADABLE_SENTENCE =
  "This file isn't a Raindrop export. In Raindrop, open Settings › Backups, create a backup and choose its CSV file.";

export interface RaindropImportHandle {
  // opens the file chooser; called inside the press that asked for it, which the chooser needs
  choose: () => void;
}

export const RaindropImport = ({
  handleRef,
}: {
  handleRef: RefObject<RaindropImportHandle | null>;
}) => {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [plan, setPlan] = useState<ImportsPlanResponse | null>(null);
  const cloudQuery = useQuery(orpc.cloud.status.queryOptions());
  const syncsOnline = cloudQuery.data?.state === "signed-in";

  useImperativeHandle(
    handleRef,
    () => ({
      choose: () => {
        inputRef.current?.click();
      },
    }),
    [],
  );

  const readPlan = async (file: File): Promise<void> => {
    const [error, planned] = await safe(client.imports.plan({ file, source: "raindrop" }));
    if (planned !== undefined) {
      setPlan(planned);
      return;
    }
    toast.error(
      isDefinedError(error) && error.code === "IMPORT_UNREADABLE"
        ? UNREADABLE_SENTENCE
        : refusalMessage(error, "The backup couldn't be read."),
    );
  };

  const start = useMutation(
    orpc.imports.start.mutationOptions({
      onError: (error) => {
        failed(error, "The import couldn't start.");
      },
      onSuccess: () => {
        setPlan(null);
        toast.success("Importing from Raindrop");
        void queryClient.invalidateQueries({ queryKey: orpc.imports.status.key() });
      },
    }),
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label="Raindrop backup"
        onChange={(event) => {
          const [file] = event.currentTarget.files ?? [];
          event.currentTarget.value = "";
          if (file !== undefined) {
            void readPlan(file);
          }
        }}
      />
      <ImportDialog
        plan={plan}
        syncsOnline={syncsOnline}
        starting={start.isPending}
        onStart={(chosen) => {
          start.mutate({ planId: chosen.planId });
        }}
        onClose={() => {
          setPlan(null);
        }}
      />
    </>
  );
};
