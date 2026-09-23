import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";

import { GalleryPage } from "@/components/gallery/gallery-page";
import { ThemeProvider } from "@/components/theme-provider";

const DesignPage = () => {
  const navigate = useNavigate();
  return (
    <ThemeProvider>
      <TooltipProvider>
        <GalleryPage
          onBack={() => {
            void navigate({ to: "/" });
          }}
        />
        <ConfirmDialogHost />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
};

// ssr: false because the demos read the browser (theme storage, pointer proximity).
export const Route = createFileRoute("/design")({
  ssr: false,
  head: () => ({ meta: [{ title: "inteligir design system" }] }),
  component: DesignPage,
});
