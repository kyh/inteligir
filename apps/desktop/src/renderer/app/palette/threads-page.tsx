import { CommandEmpty, CommandGroup, CommandItem } from "@repo/ui/components/command";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import { skipToken, useQuery } from "@tanstack/react-query";
import { MessagesSquareIcon } from "lucide-react";
import { orpc } from "../api";
import { threadActivity, THREAD_ACTIVITY_LABELS } from "../thread-activity";
import { matchesQuery, PalettePage, SEARCH_DEBOUNCE_MS, useDebounced } from "./palette-page";

const THREAD_ROWS = 30;

const threadRowLabel = (thread: Thread): string => thread.title ?? "Action";

const threadRowDetail = (thread: Thread): string => {
  const activity = THREAD_ACTIVITY_LABELS[threadActivity(thread)];
  return thread.originDocPath === null ? activity : `${activity} · ${thread.originDocPath}`;
};

const matchesThread = (thread: Thread, query: string): boolean =>
  matchesQuery(threadRowLabel(thread), query) || matchesQuery(thread.originDocPath ?? "", query);

export interface ThreadsPageProps {
  open: boolean;
  query: string;
  // the pages the workspace already holds, newest first
  threads: readonly Thread[];
  onOpenThread: (threadId: string) => void;
}

// typed text asks the server, because the held pages are only the newest actions; the held rows
// answer an empty field, and stand in, filtered, until the server answers the text in the box.
export const ThreadsPage = ({ open, query, threads, onOpenThread }: ThreadsPageProps) => {
  const typed = query.trim();
  const settled = useDebounced(typed, SEARCH_DEBOUNCE_MS);
  const found = useQuery(
    orpc.threads.list.queryOptions({
      input: open && settled !== "" ? { limit: THREAD_ROWS, query: settled } : skipToken,
    }),
  );
  const answered = settled === typed ? found.data?.threads : undefined;
  const rows =
    typed === ""
      ? threads.slice(0, THREAD_ROWS)
      : (answered ??
        threads.filter((thread) => matchesThread(thread, typed)).slice(0, THREAD_ROWS));
  return (
    <PalettePage>
      <CommandEmpty>
        {typed === "" && threads.length === 0 ? "No actions yet." : "No action matches."}
      </CommandEmpty>
      <CommandGroup heading={typed === "" ? "Recent" : "Actions"}>
        {rows.map((thread) => (
          <CommandItem
            key={thread.id}
            action={threadRowLabel(thread)}
            onSelect={() => {
              onOpenThread(thread.id);
            }}
          >
            <MessagesSquareIcon />
            <span className="truncate">{threadRowLabel(thread)}</span>
            <span className="ml-auto truncate pl-3 text-body text-muted-foreground">
              {threadRowDetail(thread)}
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    </PalettePage>
  );
};
