// What a Raindrop backup would add, said before anything is written: the counts the plan read,
// the rows it leaves out, and, for a library that syncs, how much the pages and pictures add to
// the online library. Import starts the job; the rail says how it goes from there.

import type { ImportsPlanResponse } from "@repo/contract/local/imports/imports-schema";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { plural } from "@repo/ui/lib/plural";

import { formatCount } from "../library/item-labels";

const BYTES_PER_MB = 1024 * 1024;

// past this a synced library hears how much the import will add to it
const ONLINE_SIZE_NOTE_OVER_BYTES = 300 * BYTES_PER_MB;

const counted = (count: number, one: string, many: string): string =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

// "8,512 links in 34 folders, with 210 tags and 1,240 highlights."
const addsSentence = (plan: ImportsPlanResponse): string => {
  const links = counted(plan.items, "link", "links");
  const where =
    plan.folderCount === 0 ? "" : ` in ${counted(plan.folderCount, "folder", "folders")}`;
  const extras = [
    ...(plan.tags === 0 ? [] : [counted(plan.tags, "tag", "tags")]),
    ...(plan.highlights === 0 ? [] : [counted(plan.highlights, "highlight", "highlights")]),
  ];
  return `${links}${where}${extras.length === 0 ? "" : `, with ${extras.join(" and ")}`}.`;
};

export const importSummary = (plan: ImportsPlanResponse, syncsOnline: boolean): string[] => {
  if (plan.items === 0) {
    return [
      plan.alreadySaved === 0
        ? "This backup holds no links to add."
        : "Everything in this backup is already in your library.",
    ];
  }
  const lines = [addsSentence(plan)];
  if (plan.alreadySaved > 0) {
    lines.push(
      plan.alreadySaved === 1
        ? "1 is already in your library and stays as it is."
        : `${formatCount(plan.alreadySaved)} are already in your library and stay as they are.`,
    );
  }
  if (plan.skippedCount > 0) {
    lines.push(
      `${plural(plan.skippedCount, "row")} ${plan.skippedCount === 1 ? "is" : "are"} left out: no web address, or in Raindrop's trash.`,
    );
  }
  if (plan.droppedTags.length > 0) {
    lines.push(`These tags can't be used here and are left off: ${plan.droppedTags.join(", ")}.`);
  }
  lines.push("Each page's text and picture fill in over the next while.");
  if (syncsOnline && plan.estimatedBytes > ONLINE_SIZE_NOTE_OVER_BYTES) {
    const megabytes = Math.round(plan.estimatedBytes / BYTES_PER_MB);
    lines.push(
      `Their pages and pictures add about ${formatCount(megabytes)} MB. Your online library holds about 1 GB; once it is full, new saves stay on this Mac.`,
    );
  }
  return lines;
};

export interface ImportDialogProps {
  // the plan to confirm; null closes the dialog
  plan: ImportsPlanResponse | null;
  syncsOnline: boolean;
  starting: boolean;
  onStart: (plan: ImportsPlanResponse) => void;
  onClose: () => void;
}

export const ImportDialog = ({
  plan,
  syncsOnline,
  starting,
  onStart,
  onClose,
}: ImportDialogProps) => {
  const [lead = "", ...rest] = plan === null ? [] : importSummary(plan, syncsOnline);
  return (
    <Dialog
      open={plan !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import from Raindrop</DialogTitle>
          <DialogDescription className="text-subtitle text-ink">{lead}</DialogDescription>
        </DialogHeader>
        {rest.length === 0 ? null : (
          <div className="mb-4 space-y-2 text-subtitle text-muted-foreground">
            {rest.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="compact" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="compact"
            disabled={plan === null || starting || plan.items === 0}
            onClick={() => {
              if (plan !== null) {
                onStart(plan);
              }
            }}
          >
            Import
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
