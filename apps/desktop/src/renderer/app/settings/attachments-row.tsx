import {
  DEFAULT_ATTACHMENTS_FOLDER,
  type AttachmentLocation,
} from "@repo/api/local/vault/vault-schema";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "../api";
import { ChoiceRow, failed, Row } from "./settings-chrome";

type Choice = AttachmentLocation["kind"];

const CHOICES: readonly { value: Choice; label: string }[] = [
  { value: "folder", label: "A folder" },
  { value: "beside-note", label: "Beside the note" },
  { value: "root", label: "Vault root" },
];

export function AttachmentsRow() {
  const queryClient = useQueryClient();
  // the CLI can change this between two visits; opening the page re-reads it
  const prefsQuery = useQuery({ ...orpc.vault.prefs.queryOptions(), staleTime: 0 });
  const [folderDraft, setFolderDraft] = useState<string | null>(null);
  const setPrefs = useMutation(
    orpc.vault.setPrefs.mutationOptions({
      onSuccess: (response) => {
        queryClient.setQueryData(orpc.vault.prefs.queryKey(), response);
        setFolderDraft(null);
      },
      onError: (cause) => {
        failed(cause, "Could not change where attachments land.");
      },
    }),
  );

  const attachments = prefsQuery.data?.attachments;
  if (attachments === undefined) {
    return <Row label="Attachments">…</Row>;
  }
  const storedFolder = attachments.kind === "folder" ? attachments.path : null;
  const folderPath = folderDraft ?? storedFolder ?? DEFAULT_ATTACHMENTS_FOLDER;

  const choose = (kind: Choice): void => {
    const next: AttachmentLocation =
      kind === "folder"
        ? { kind, path: folderPath.trim() || DEFAULT_ATTACHMENTS_FOLDER }
        : { kind };
    setPrefs.mutate({ attachments: next });
  };

  return (
    <Row label="Attachments">
      <ChoiceRow label="Attachments" options={CHOICES} value={attachments.kind} onChange={choose} />
      {attachments.kind === "folder" ? (
        <form
          className="mt-1.5 flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            choose("folder");
          }}
        >
          <Input
            aria-label="Attachments folder"
            value={folderPath}
            onChange={(event) => {
              setFolderDraft(event.target.value);
            }}
            className="h-7 max-w-64 font-mono text-xs"
          />
          <Button
            type="submit"
            variant="tertiary"
            size="compact"
            disabled={folderDraft === null || folderDraft === storedFolder || setPrefs.isPending}
          >
            Use folder
          </Button>
        </form>
      ) : null}
      <span className="mt-1 block text-xs text-muted-foreground">
        Where a pasted image is written. A folder is created on the first paste.
      </span>
    </Row>
  );
}
