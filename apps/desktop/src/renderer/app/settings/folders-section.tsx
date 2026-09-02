// A typed path field rather than a picker: a browser has no native directory
// picker, and the desktop shell ships no IPC to add one.

import type { ConnectedFoldersResponse } from "@repo/api/local/folders/folders-schema";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { isDefinedError, orpc } from "../api";
import { failed, SectionHeading } from "./settings-chrome";

function useConnectedFolders() {
  return useQuery({ ...orpc.folders.list.queryOptions(), staleTime: 0 });
}

export function FoldersSection() {
  const queryClient = useQueryClient();
  const foldersQuery = useConnectedFolders();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = (response: ConnectedFoldersResponse): void => {
    queryClient.setQueryData(orpc.folders.list.queryKey(), response);
  };

  const clearError = (): void => {
    setError(null);
  };

  // A declared refusal is about this path and sits beside the field; anything
  // else is about the connection and toasts.
  const addFolder = useMutation(
    orpc.folders.add.mutationOptions({
      onMutate: clearError,
      onSuccess: (response) => {
        refresh(response);
        setDraft("");
      },
      onError: (cause) => {
        if (isDefinedError(cause)) {
          setError(cause.message);
          return;
        }
        failed(cause, "Could not add the folder.");
      },
    }),
  );

  const removeFolder = useMutation(
    orpc.folders.remove.mutationOptions({
      onMutate: clearError,
      onSuccess: refresh,
      onError: (cause) => {
        if (isDefinedError(cause)) {
          setError(cause.message);
          return;
        }
        failed(cause, "Could not remove the folder.");
      },
    }),
  );

  const busy = addFolder.isPending || removeFolder.isPending;

  const add = (): void => {
    const path = draft.trim();
    if (path.length === 0 || busy) {
      return;
    }
    addFolder.mutate({ path });
  };

  const folders = foldersQuery.data?.folders ?? [];

  return (
    <section className="space-y-2">
      <SectionHeading>Connected folders</SectionHeading>
      <p className="text-xs text-muted-foreground">
        Folders the agent is pointed at as read-only reference context. Applies from the agent's
        next session.
      </p>
      {folders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No folders connected.</p>
      ) : (
        <ul className="space-y-1">
          {folders.map((folder) => (
            <li key={folder} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={folder}>
                {folder}
              </span>
              <Button
                variant="ghost"
                size="compact"
                disabled={busy}
                onClick={() => {
                  removeFolder.mutate({ path: folder });
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          placeholder="/absolute/path/to/folder"
          aria-label="Folder path"
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button
          type="submit"
          variant="tertiary"
          size="compact"
          disabled={busy || draft.trim() === ""}
        >
          Connect
        </Button>
      </form>
      {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
