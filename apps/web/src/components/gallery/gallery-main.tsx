// a dev-only entry (gallery.html under vite.gallery.config.ts) so the gallery never ships in the
// Worker: TanStack Start has no dev-only route, and any route file emits its chunk into the build.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { RadiusProvider } from "@repo/ui/lib/radius-context";
import { SizeProvider } from "@repo/ui/lib/size-context";

import { ThemeProvider } from "@/components/theme-provider";

import { GalleryPage } from "./gallery-page";
import "@/styles/globals.css";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("gallery.html has no #root to mount into");
}

// the site root's providers, so every demo renders as it does on the site
createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <MotionPolicy>
        <RadiusProvider radius="rounded">
          <SizeProvider size="compact">
            <TooltipProvider>
              <GalleryPage />
              <ConfirmDialogHost />
              <Toaster position="bottom-right" />
            </TooltipProvider>
          </SizeProvider>
        </RadiusProvider>
      </MotionPolicy>
    </ThemeProvider>
  </StrictMode>,
);
