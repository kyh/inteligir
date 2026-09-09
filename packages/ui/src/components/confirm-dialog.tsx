"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";
import { Button } from "@repo/ui/components/button";

interface ConfirmOptions {
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
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);

  const settle = (confirmed: boolean) => {
    pending?.resolve(confirmed);
    confirmStore.set(null);
  };

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) {
          settle(false);
        }
      }}
    >
      <AlertDialogContent size="sm" initialFocus={confirmButtonRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
        </AlertDialogHeader>
        {options?.body !== undefined && (
          <AlertDialogDescription>{options.body}</AlertDialogDescription>
        )}
        <AlertDialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              settle(false);
            }}
          >
            {options?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            ref={confirmButtonRef}
            variant={options?.destructive === true ? "destructive" : "primary"}
            onClick={() => {
              settle(true);
            }}
          >
            {options?.confirmLabel ?? "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
