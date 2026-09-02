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

type ConfirmOptions = {
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  destructive?: boolean;
};

type PendingConfirm = {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
};

type ConfirmSnapshot = {
  pending: PendingConfirm | null;
  options: ConfirmOptions | null;
};

type Listener = () => void;

type ConfirmStore = {
  snapshot: ConfirmSnapshot;
  listeners: Set<Listener>;
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => ConfirmSnapshot;
  set: (pending: PendingConfirm | null) => void;
};

const confirmStore: ConfirmStore = {
  snapshot: { pending: null, options: null },
  listeners: new Set<Listener>(),
  subscribe(listener: Listener): () => void {
    confirmStore.listeners.add(listener);
    return () => {
      confirmStore.listeners.delete(listener);
    };
  },
  getSnapshot(): ConfirmSnapshot {
    return confirmStore.snapshot;
  },
  set(pending: PendingConfirm | null): void {
    confirmStore.snapshot = {
      pending,
      options: pending?.options ?? confirmStore.snapshot.options,
    };
    for (const listener of confirmStore.listeners) listener();
  },
};

// without a mounted ConfirmDialogHost the promise stays pending, never a false positive.
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    confirmStore.getSnapshot().pending?.resolve(false);
    confirmStore.set({ options, resolve });
  });
}

export function ConfirmDialogHost() {
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
        if (!open) settle(false);
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
          <Button variant="secondary" onClick={() => settle(false)}>
            {options?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            ref={confirmButtonRef}
            variant={options?.destructive ? "destructive" : "primary"}
            onClick={() => settle(true)}
          >
            {options?.confirmLabel ?? "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
