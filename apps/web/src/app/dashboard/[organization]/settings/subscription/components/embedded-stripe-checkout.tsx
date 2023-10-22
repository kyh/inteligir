"use client";

import { loadStripe } from "@stripe/stripe-js";
import { useState } from "react";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { clx } from "@inteligir/ui";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Close as DialogPrimitiveClose } from "@radix-ui/react-dialog";
import { Dialog, DialogContent } from "@inteligir/ui/dialog";
import IconButton from "@inteligir/ui/icon-button";
import If from "@inteligir/ui/if";
import LogoImage from "@inteligir/ui/logo/logo-image";
import Button from "@inteligir/ui/button";
import Trans from "@inteligir/ui/trans";
import configuration from "@/configuration";
import { StripeCheckoutDisplayMode } from "@/lib/stripe/types";

const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

if (!STRIPE_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY environment variable. Did you forget to add it to your .env file?",
  );
}

const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);

export default ({
  clientSecret,
  onClose,
}: React.PropsWithChildren<{
  clientSecret: string;
  onClose?: () => void;
}>) => (
  <EmbeddedCheckoutPopup key={clientSecret} onClose={onClose}>
    <EmbeddedCheckoutProvider options={{ clientSecret }} stripe={stripePromise}>
      <EmbeddedCheckout className="EmbeddedCheckoutClassName" />
    </EmbeddedCheckoutProvider>
  </EmbeddedCheckoutPopup>
);

const EmbeddedCheckoutPopup = ({
  onClose,
  children,
}: React.PropsWithChildren<{
  onClose?: () => void;
}>) => {
  const [open, setOpen] = useState(true);

  const displayMode = configuration.stripe.displayMode;
  const isPopup = displayMode === StripeCheckoutDisplayMode.Popup;
  const isOverlay = displayMode === StripeCheckoutDisplayMode.Overlay;

  const className = clx({
    [`bg-white p-4 max-h-[98vh] overflow-y-auto shadow-transparent border border-gray-200 dark:border-dark-700`]:
      isPopup,
    [`bg-background !flex flex-col flex-1 fixed top-0 !max-h-full !max-w-full left-0 w-screen h-screen border-transparent shadow-transparent py-4 px-8`]:
      isOverlay,
  });

  const close = () => {
    setOpen(false);

    if (onClose) {
      onClose();
    }
  };

  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open && onClose) {
          onClose();
        }

        setOpen(open);
      }}
      open={open}
    >
      <DialogContent
        className={className}
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <If condition={isOverlay}>
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <LogoImage />

              <Button onClick={close} variant="outline">
                <Trans i18nKey="common:cancel" />
              </Button>
            </div>
          </div>
        </If>

        <If condition={isPopup}>
          <DialogPrimitiveClose asChild>
            <IconButton
              className="absolute right-4 top-2 flex items-center"
              label="Close Checkout"
              onClick={close}
            >
              <XMarkIcon className="h-6 text-gray-900" />
              <span className="sr-only">
                <Trans i18nKey="common:cancel" />
              </span>
            </IconButton>
          </DialogPrimitiveClose>
        </If>

        <div
          className={clx({
            [`flex-1 rounded-xl bg-white p-8`]: isOverlay,
          })}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
};
