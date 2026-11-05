// The rail's footer line: where the library on this page stands (`sync-words.ts`), drawn from the
// replica's status and the browser's connection. A change the library refused waits here for the
// person, who sends it again or lets it go.

import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { cn } from "@repo/ui/lib/cn";

import { useReplica, useReplicaStatus } from "../cloud/library-context";
import { useOnline } from "../cloud/needs-connection";
import { syncWords } from "./sync-words";
import type { SyncTone } from "./sync-words";

const TONE_DOT = {
  attention: "bg-destructive",
  busy: "bg-primary animate-pulse",
  quiet: "bg-success",
  waiting: "bg-muted-foreground",
} satisfies Record<SyncTone, string>;

export const SyncLine = () => {
  const replica = useReplica();
  const status = useReplicaStatus();
  const words = syncWords(status, useOnline());
  const line = (
    <span className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[words.tone])}
      />
      <span className="truncate" data-sync-state={words.tone}>
        {words.text}
      </span>
    </span>
  );
  if (status.parked.length === 0) {
    return <div className="min-w-0 flex-1 px-2">{line}</div>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="compact" className="min-w-0 flex-1 justify-start" />}
      >
        {line}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        {status.parked.map((write) => (
          <div key={write.seq}>
            <DropdownMenuLabel>{write.reason}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                void replica.retry(write.seq);
              }}
            >
              Try again
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                void replica.discard(write.seq);
              }}
            >
              Let it go
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
