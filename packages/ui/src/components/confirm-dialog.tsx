"use client";

import * as React from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";

import { Button } from "@repo/ui/components/button";
import { DialogCard, renderDialogBackdrop } from "@repo/ui/components/dialog";
import { PopupOpen, PopupPresence } from "@repo/ui/lib/popup-presence";

export interface ConfirmOptions {
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  destructive?: boolean;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

interface ConfirmSnapshot {
  pending: PendingConfirm | null;
  options: ConfirmOptions | null;
}

type Listener = () => void;

interface ConfirmStore {
  snapshot: ConfirmSnapshot;
  listeners: Set<Listener>;
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => ConfirmSnapshot;
  set: (pending: PendingConfirm | null) => void;
}

const confirmStore: ConfirmStore = {
  getSnapshot(): ConfirmSnapshot {
    return confirmStore.snapshot;
  },
  listeners: new Set<Listener>(),
  set(pending: PendingConfirm | null): void {
    confirmStore.snapshot = {
      options: pending?.options ?? confirmStore.snapshot.options,
      pending,
    };
    for (const listener of confirmStore.listeners) {
      listener();
    }
  },
  snapshot: { options: null, pending: null },
  subscribe(listener: Listener): () => void {
    confirmStore.listeners.add(listener);
    return () => {
      confirmStore.listeners.delete(listener);
    };
  },
};

// without a mounted ConfirmDialogHost the promise stays pending, never a false positive.
export const confirm = async (options: ConfirmOptions): Promise<boolean> =>
  // oxlint-disable-next-line promise/avoid-new -- the answer arrives from a click on the mounted host, so there is no upstream promise to return
  await new Promise<boolean>((resolve) => {
    confirmStore.getSnapshot().pending?.resolve(false);
    confirmStore.set({ options, resolve });
  });

export const ConfirmDialogHost = () => {
  const { pending, options } = React.useSyncExternalStore(
    confirmStore.subscribe,
    confirmStore.getSnapshot,
    confirmStore.getSnapshot,
  );
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  // Enter confirms what can be undone; a destructive answer takes a deliberate move to reach
  const destructive = options?.destructive === true;

  const settle = (confirmed: boolean) => {
    pending?.resolve(confirmed);
    confirmStore.set(null);
  };

  const open = pending !== null;

  // Dialog's backdrop and card over the alert primitive's own parts, which keep the alertdialog
  // role and refuse an outside-press dismissal; controlled, since the Portal's presence reads the
  // open it is handed
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          settle(false);
        }
      }}
    >
      <PopupOpen open={open}>
        <PopupPresence>
          <AlertDialog.Portal keepMounted>
            <AlertDialog.Backdrop render={renderDialogBackdrop} />
            <AlertDialog.Popup
              initialFocus={destructive ? cancelButtonRef : confirmButtonRef}
              render={(popupProps) => (
                <DialogCard popupProps={popupProps} className="grid w-full max-w-xs gap-6" />
              )}
            >
              <AlertDialog.Title className="text-center font-heading text-title font-medium">
                {options?.title}
              </AlertDialog.Title>
              {options?.body !== undefined && (
                <AlertDialog.Description className="text-subtitle text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground">
                  {options.body}
                </AlertDialog.Description>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  ref={cancelButtonRef}
                  variant="secondary"
                  onClick={() => {
                    settle(false);
                  }}
                >
                  {options?.cancelLabel ?? "Cancel"}
                </Button>
                <Button
                  ref={confirmButtonRef}
                  variant={destructive ? "destructive" : "primary"}
                  onClick={() => {
                    settle(true);
                  }}
                >
                  {options?.confirmLabel ?? "Confirm"}
                </Button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </PopupPresence>
      </PopupOpen>
    </AlertDialog.Root>
  );
};
