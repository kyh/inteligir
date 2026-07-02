"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { cn } from "@repo/ui/lib/utils";
import { Button } from "@repo/ui/components/button";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";

// A dialog floats four elevation steps above whatever surface it opens over
// (mirrors DIALOG_OFFSET in dialog.tsx).
const DIALOG_OFFSET = 4;

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/40 duration-100 dark:bg-black/80 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  size = "default",
  children,
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: "default" | "sm";
}) {
  const substrate = useSurface();
  const dialogLevel = Math.min(substrate + DIALOG_OFFSET, 8);
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-6 rounded-3xl p-6 text-popover-foreground duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          surfaceClasses(dialogLevel),
          className,
        )}
        {...props}
      >
        <SurfaceProvider value={dialogLevel}>{children}</SurfaceProvider>
      </AlertDialogPrimitive.Popup>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "font-heading text-lg font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Imperative global alert dialog. Call `alertDialog.open(title, options)` from
 * anywhere; render <GlobalAlertDialog /> once at the root.
 */
type AlertState = {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: {
    hidden?: boolean;
    label?: React.ReactNode;
    onClick?: () => void | Promise<unknown>;
  };
  cancel?: {
    hidden?: boolean;
    label?: React.ReactNode;
    onClick?: () => void | Promise<unknown>;
  };
};

type Listener = () => void;

type AlertDialogStore = {
  state: AlertState;
  listeners: Listener[];
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => AlertState;
  emitChange: () => void;
};

const alertDialogStore: AlertDialogStore = {
  state: { open: false, title: "" },
  listeners: [],
  subscribe: (listener: Listener) => {
    alertDialogStore.listeners.push(listener);
    return () => {
      alertDialogStore.listeners = alertDialogStore.listeners.filter((l) => l !== listener);
    };
  },
  getSnapshot: () => alertDialogStore.state,
  emitChange: () => {
    alertDialogStore.listeners.forEach((listener) => listener());
  },
};

const alertDialog = {
  open: (title: React.ReactNode, options: Omit<AlertState, "open" | "title">) => {
    alertDialogStore.state = { open: true, title, ...options };
    alertDialogStore.emitChange();
  },
  close: () => {
    alertDialogStore.state = { ...alertDialogStore.state, open: false };
    alertDialogStore.emitChange();
  },
};

// Composable primitives for feature-owned confirms (mirrors dialog.tsx's
// export surface) — GlobalAlertDialog below stays the imperative root.
export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
};

export const GlobalAlertDialog = () => {
  const [pendingAction, setPendingAction] = React.useState(false);
  const [pendingCancel, setPendingCancel] = React.useState(false);
  const alertState = React.useSyncExternalStore(
    alertDialogStore.subscribe,
    alertDialogStore.getSnapshot,
    alertDialogStore.getSnapshot,
  );

  const runAndClose = async (
    onClick: (() => void | Promise<unknown>) | undefined,
    setPending: (v: boolean) => void,
  ) => {
    setPending(true);
    try {
      await onClick?.();
    } finally {
      setPending(false);
      alertDialog.close();
    }
  };

  const onOpenChange = (open: boolean) => {
    if (pendingAction || pendingCancel) return;
    if (!open) {
      void runAndClose(alertState.cancel?.onClick, setPendingCancel);
    }
  };

  const onConfirm = () => {
    void runAndClose(alertState.action?.onClick, setPendingAction);
  };

  return (
    <AlertDialog open={alertState.open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{alertState.title}</AlertDialogTitle>
        </AlertDialogHeader>
        {alertState.description && (
          <AlertDialogDescription>{alertState.description}</AlertDialogDescription>
        )}
        <AlertDialogFooter>
          {!alertState.action?.hidden && (
            <Button onClick={onConfirm} loading={pendingAction}>
              {alertState.action?.label ?? "Confirm"}
            </Button>
          )}
          {!alertState.cancel?.hidden && (
            <Button variant="secondary" onClick={() => onOpenChange(false)} loading={pendingCancel}>
              {alertState.cancel?.label ?? "Close"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
