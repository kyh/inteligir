// The Mac app's update, said in a card the library's layout keeps at the bottom right while there
// is something to do about it: nothing downloads or restarts without the person's click. It reads
// the store Settings' Updates row reads, so the two say one thing; a tab has no updater and shows
// none. Not a popup: it has no anchor and no dismissal of its own, and leaves when the update does.

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
import { DownloadIcon, Loader2Icon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { moveUpdate, useDesktopUpdates } from "./desktop-updates";
import type { UpdateMove } from "./desktop-updates";

const UpdateCard = ({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) => (
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Card renders a div; `output` is a form's result, not a notice
  <Card role="status" className="fixed right-4 bottom-4 z-50 w-full max-w-sm">
    <CardHeader>
      <div className="flex items-center gap-2">
        {icon}
        <CardTitle>{title}</CardTitle>
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    {children}
  </Card>
);

const UpdateAction = ({
  move,
  label,
  variant = "primary",
}: {
  move: UpdateMove;
  label: string;
  variant?: "primary" | "tertiary";
}) => (
  <CardFooter className="justify-end">
    <Button
      size="compact"
      variant={variant}
      onClick={() => {
        void moveUpdate(move);
      }}
    >
      {label}
    </Button>
  </CardFooter>
);

export const DesktopUpdateBanner = () => {
  const state = useDesktopUpdates();
  switch (state?.status) {
    case "available": {
      return (
        <UpdateCard
          icon={<DownloadIcon className="size-4 text-muted-foreground" />}
          title="Update available"
          description={`Inteligir ${state.version} is ready to download.`}
        >
          <UpdateAction move="download" label="Download" />
        </UpdateCard>
      );
    }
    case "downloading": {
      return (
        <UpdateCard
          icon={<Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
          title="Downloading the update"
          description={`${String(state.downloadPercent)}% complete`}
        >
          <CardContent>
            <Progress value={state.downloadPercent} aria-label="Download progress" />
          </CardContent>
        </UpdateCard>
      );
    }
    case "downloaded": {
      return (
        <UpdateCard
          icon={<RotateCwIcon className="size-4 text-muted-foreground" />}
          title="Update ready"
          description={`Restart to finish installing Inteligir ${state.version}.`}
        >
          <UpdateAction move="install" label="Restart" />
        </UpdateCard>
      );
    }
    case "error": {
      return (
        <UpdateCard
          icon={<TriangleAlertIcon className="size-4 text-destructive" />}
          title="The update didn't go through"
          description={state.message}
        >
          <UpdateAction move="check" label="Try again" variant="tertiary" />
        </UpdateCard>
      );
    }
    default: {
      return null;
    }
  }
};
