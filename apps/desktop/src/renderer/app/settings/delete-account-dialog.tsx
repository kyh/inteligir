// Deleting the account asks for the password again: this Mac's sign-in alone would let anyone at
// it end the account, and the cloud checks the password before it deletes anything. The dialog
// names what goes and what stays before the one button that cannot be undone.

import { CLOUD_PASSWORD_MAX_LENGTH } from "@repo/api/local/cloud/cloud-schema";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { useId, useState } from "react";

const DELETED = [
  "The online copy of your notes",
  "Your synced conversations with the agent",
  "Captures from your phone that haven't reached a Mac",
  "The sign-in on every device, this Mac included",
] as const;

export interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (password: string) => void;
  pending: boolean;
  // the cloud's own words for why it said no
  refusal: string | null;
}

export const DeleteAccountDialog = ({
  open,
  onOpenChange,
  onDelete,
  pending,
  refusal,
}: DeleteAccountDialogProps) => {
  const passwordId = useId();
  const [password, setPassword] = useState("");
  // cleared as it opens and as it closes, so a typed password never outlives the dialog
  const [shownOpen, setShownOpen] = useState(open);
  if (shownOpen !== open) {
    setShownOpen(open);
    setPassword("");
  }
  const ready = password !== "" && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) {
              onDelete(password);
            }
          }}
        >
          <div className="space-y-1">
            <p className="text-body">Deleted for good:</p>
            <ul className="list-disc space-y-0.5 pl-4 text-body text-muted-foreground">
              {DELETED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <p className="text-body">Your notes on this Mac and their history stay here.</p>
          <div className="flex items-center gap-2">
            <Label htmlFor={passwordId} className="w-24 shrink-0 text-body">
              Password
            </Label>
            <Input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              autoFocus
              maxLength={CLOUD_PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </div>
          {refusal === null ? null : <p className="text-body text-destructive">{refusal}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              size="compact"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="compact" disabled={!ready}>
              {pending ? "Deleting…" : "Delete account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
