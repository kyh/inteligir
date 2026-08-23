// Feedback: what the app says back — progress, separation, and notices.

import { Button } from "@repo/ui/components/button";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { Separator } from "@repo/ui/components/separator";
import { toast } from "@repo/ui/components/sonner";
import { Spinner } from "@repo/ui/components/spinner";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

const SCROLL_ROWS = [
  "Release checklist",
  "Weekly review",
  "Kitchen Sink",
  "Getting Started",
  "Use Cases",
  "Vault conventions",
  "Agent notes",
  "Reading list",
];

export function FeedbackSection() {
  return (
    <GallerySection id="feedback" title="Feedback">
      <Demo name="Spinner" purpose="Work is happening and the wait is short enough not to name it.">
        <DemoCase label="default">
          <Spinner />
        </DemoCase>
        <DemoCase label="in a button">
          <Button variant="secondary" loading>
            Committing
          </Button>
        </DemoCase>
      </Demo>

      <Demo name="Separator" purpose="A rule between groups that belong to the same surface." stack>
        <div className="w-72 space-y-3">
          <p className="text-sm">Vault</p>
          <Separator />
          <p className="text-sm">Agent</p>
        </div>
        <div className="flex h-8 items-center gap-3">
          <span className="text-sm">Local</span>
          <Separator orientation="vertical" />
          <span className="text-sm">Synced</span>
        </div>
      </Demo>

      <Demo
        name="ScrollArea"
        purpose="A bounded region with the app's own scrollbar instead of the platform's."
        stack
      >
        <ScrollArea className="h-40 w-64 rounded-lg border border-line">
          <ul className="p-2 text-sm">
            {SCROLL_ROWS.map((row) => (
              <li key={row} className="rounded-md px-2 py-1.5 hover:bg-hover">
                {row}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Demo>

      <Demo
        name="toast()"
        purpose="A notice about something that already happened. Never the only place an error appears."
      >
        <Button
          variant="secondary"
          onClick={() => {
            toast.success("Copied for an external agent");
          }}
        >
          Success toast
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            toast.error("Could not reach the vault");
          }}
        >
          Error toast
        </Button>
      </Demo>
    </GallerySection>
  );
}
