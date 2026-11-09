// Feedback: what the app says back — progress, separation, and notices.

import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Progress } from "@repo/ui/components/progress";
import { Separator } from "@repo/ui/components/separator";
import { toast } from "@repo/ui/components/sonner";
import { Spinner } from "@repo/ui/components/spinner";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

export const FeedbackSection = () => (
  <GallerySection id="feedback" title="Feedback">
    <Demo name="Spinner" purpose="Work is happening and the wait is short enough not to name it.">
      <DemoCase label="default">
        <Spinner />
      </DemoCase>
      <DemoCase label="in a button">
        <Button variant="secondary" loading>
          Saving
        </Button>
      </DemoCase>
    </Demo>

    <Demo name="Progress" purpose="Work whose share done is known, said as a bar." stack>
      <div className="w-72 space-y-3">
        <Progress value={0} aria-label="Not started" />
        <Progress value={40} aria-label="Under way" />
        <Progress value={100} aria-label="Done" />
      </div>
    </Demo>

    <Demo
      name="Card"
      purpose="A notice that stays up while there is something to do about it, and offers the next step."
    >
      <DemoCase label="sm, with an action">
        <Card size="sm" className="w-80">
          <CardHeader>
            <CardTitle>Update available</CardTitle>
            <CardDescription>Inteligir 1.2.3 is ready to download.</CardDescription>
          </CardHeader>
          <CardFooter className="justify-end">
            <Button size="compact">Download</Button>
          </CardFooter>
        </Card>
      </DemoCase>
      <DemoCase label="default, with content">
        <Card className="w-80">
          <CardHeader>
            <CardTitle>Downloading the update</CardTitle>
            <CardDescription>40% complete</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={40} aria-label="Download progress" />
          </CardContent>
        </Card>
      </DemoCase>
    </Demo>

    <Demo name="Separator" purpose="A rule between groups that belong to the same surface." stack>
      <div className="w-72 space-y-3">
        <p className="text-sm">Library</p>
        <Separator />
        <p className="text-sm">Agent</p>
      </div>
      <div className="flex h-8 items-center gap-3">
        <span className="text-sm">Folders</span>
        <Separator orientation="vertical" />
        <span className="text-sm">Tags</span>
      </div>
    </Demo>

    <Demo
      name="toast()"
      purpose="A notice about something that already happened. Never the only place an error appears."
    >
      <Button
        variant="secondary"
        onClick={() => {
          toast.success("Moved 2 items to Deleted.");
        }}
      >
        Success toast
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          toast.error("Could not reach the library");
        }}
      >
        Error toast
      </Button>
    </Demo>
  </GallerySection>
);
