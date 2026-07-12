"use client";

// Promise-based confirm on the alert-dialog primitives — the styled
// replacement for the browser-native confirm. Call `confirm({ ... })` from any event
// handler and await the user's answer; render <ConfirmDialogHost /> once at
// the app root. Generalizes the delegation dock's restore dialog (local
// state + AlertDialog* composition) into a single shared affordance.
//
// Keyboard contract: the confirm button takes initial focus so Enter
// confirms; Base UI's alert dialog traps focus, cancels on Escape, and
// returns focus to the previously focused element on close.

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

export type ConfirmOptions = {
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  /** Styles the confirm button as destructive (delete-shaped actions). */
  destructive?: boolean;
};

type PendingConfirm = {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
};

type Listener = () => void;

type ConfirmStore = {
  pending: PendingConfirm | null;
  listeners: Set<Listener>;
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => PendingConfirm | null;
  set: (pending: PendingConfirm | null) => void;
};

const confirmStore: ConfirmStore = {
  pending: null,
  listeners: new Set<Listener>(),
  subscribe(listener: Listener): () => void {
    confirmStore.listeners.add(listener);
    return () => {
      confirmStore.listeners.delete(listener);
    };
  },
  getSnapshot(): PendingConfirm | null {
    return confirmStore.pending;
  },
  set(pending: PendingConfirm | null): void {
    confirmStore.pending = pending;
    for (const listener of confirmStore.listeners) listener();
  },
};

/**
 * Ask the user to confirm an action. Resolves true on confirm, false on
 * cancel (button, Escape, or backdrop). Requires a mounted
 * <ConfirmDialogHost />; without one the promise stays pending — same shape
 * as a dismissed dialog, never a false positive.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // One confirm at a time: a newer ask settles the older one as canceled.
    confirmStore.pending?.resolve(false);
    confirmStore.set({ options, resolve });
  });
}

export function ConfirmDialogHost() {
  const pending = React.useSyncExternalStore(
    confirmStore.subscribe,
    confirmStore.getSnapshot,
    confirmStore.getSnapshot,
  );
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  // Hold the last options through the close animation so the popup doesn't
  // blank out while it fades.
  const lastOptionsRef = React.useRef<ConfirmOptions | null>(null);
  if (pending) lastOptionsRef.current = pending.options;
  const options = pending?.options ?? lastOptionsRef.current;

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
            variant={options?.destructive ? "destructive" : "default"}
            onClick={() => settle(true)}
          >
            {options?.confirmLabel ?? "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
