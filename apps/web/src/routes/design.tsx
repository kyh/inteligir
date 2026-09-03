import { Suspense, lazy } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";

import { ThemeProvider } from "@/components/theme-provider";

// lazy: the gallery imports every component in the design system, so it gets its own chunk.
// ssr: false because the demos read the browser (theme storage, pointer proximity).
const GalleryPage = lazy(async () => {
  const module = await import("@/components/gallery/gallery-page");
  return { default: module.GalleryPage };
});

export const Route = createFileRoute("/design")({
  ssr: false,
  head: () => ({ meta: [{ title: "inteligir design system" }] }),
  component: DesignPage,
});

function DesignPage() {
  const navigate = useNavigate();
  return (
    <ThemeProvider>
      <TooltipProvider>
        <Suspense fallback={<div className="min-h-dvh bg-surface" />}>
          <GalleryPage
            onBack={() => {
              void navigate({ to: "/" });
            }}
          />
        </Suspense>
        <ConfirmDialogHost />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}
