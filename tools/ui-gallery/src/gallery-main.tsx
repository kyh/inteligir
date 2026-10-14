import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { SizeProvider } from "@repo/ui/lib/size-context";
import { ThemeProvider } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";

import { GalleryPage } from "./gallery-page";
import "@repo/ui/globals.css";

// the product's radius and size, so a demo looks as the window draws it
const Gallery = () => {
  const [theme, setTheme] = useState<Theme>("system");
  return (
    <ThemeProvider theme={theme} setTheme={setTheme}>
      <MotionPolicy>
        <SizeProvider size="compact">
          <TooltipProvider>
            <GalleryPage />
            <ConfirmDialogHost />
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </SizeProvider>
      </MotionPolicy>
    </ThemeProvider>
  );
};

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("index.html has no #root to mount into");
}

createRoot(container).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
