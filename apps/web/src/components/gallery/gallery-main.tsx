// a dev-only entry (gallery.html under vite.gallery.config.ts) so the gallery never ships in the
// Worker: TanStack Start has no dev-only route, and any route file emits its chunk into the build.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";

import { SiteProviders } from "@/components/site-providers";

import { GalleryPage } from "./gallery-page";
import "@/styles/globals.css";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("gallery.html has no #root to mount into");
}

createRoot(container).render(
  <StrictMode>
    <SiteProviders>
      <TooltipProvider>
        <GalleryPage />
        <ConfirmDialogHost />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </SiteProviders>
  </StrictMode>,
);
