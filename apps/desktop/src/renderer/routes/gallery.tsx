// The component gallery as its own route. LAZY on purpose: the gallery imports
// every component in the design system, so bundling it with the product would
// make every reader download a reference only a developer opens. The dynamic
// import puts it in its own chunk, fetched on the first visit to /gallery.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { WorkspaceProvider } from "../app/workspace-context";

const GalleryPage = lazy(async () => {
  const module = await import("../app/gallery/gallery-page");
  return { default: module.GalleryPage };
});

export const Route = createFileRoute("/gallery")({
  component: Gallery,
});

function Gallery() {
  const navigate = useNavigate();
  return (
    // WorkspaceProvider for the same reason /settings takes it: ThemeProvider
    // lives inside it, and the gallery's theme switch is how a reader checks a
    // component in both palettes.
    <WorkspaceProvider>
      <Suspense fallback={<div className="min-h-dvh bg-surface" />}>
        <GalleryPage
          onBack={() => {
            void navigate({ to: "/" });
          }}
        />
      </Suspense>
    </WorkspaceProvider>
  );
}
