// Settings → Connected folders (issue #601, Moss parity): directories agent
// sessions are TOLD ABOUT as read-only reference context. Deliberately not
// described as granting anything — the agent's shell can already read what
// this user can; these rows only name what the user wants treated as
// reference. A typed path field rather than a picker: a browser has no native
// directory picker worth the name, and the desktop shell ships no IPC to add
// one (its whole security story is having none).

import type { ConnectedFoldersResponse } from "@repo/server-contract/folders";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";
import { failed, SectionHeading } from "./settings-chrome";

function useConnectedFolders() {
  const { api } = useWorkspace();
  return useQuery<ConnectedFoldersResponse>({
    queryKey: queryKeys.folders,
    queryFn: async () => unwrap(await api.folders.$get()),
    staleTime: 0,
  });
}

export function FoldersSection() {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const foldersQuery = useConnectedFolders();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = (response: ConnectedFoldersResponse): void => {
    queryClient.setQueryData(queryKeys.folders, response);
  };

  const add = async (): Promise<void> => {
    const path = draft.trim();
    if (path.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.folders.add.$post({ json: { path } });
      if (!response.ok) {
        const body = await response.json();
        setError(body.message);
        return;
      }
      refresh(await response.json());
      setDraft("");
    } catch (cause) {
      failed(cause, "Could not add the folder.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.folders.remove.$post({ json: { path } });
      if (!response.ok) {
        const body = await response.json();
        setError(body.message);
        return;
      }
      refresh(await response.json());
    } catch (cause) {
      failed(cause, "Could not remove the folder.");
    } finally {
      setBusy(false);
    }
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
                size="xs"
                disabled={busy}
                onClick={() => {
                  void remove(folder);
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
          void add();
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
        <Button type="submit" variant="outline" size="xs" disabled={busy || draft.trim() === ""}>
          Connect
        </Button>
      </form>
      {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
