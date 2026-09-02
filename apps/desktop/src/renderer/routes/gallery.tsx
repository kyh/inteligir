// Lazy: the gallery imports every component in the design system, so it gets
// its own chunk.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

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
    <Suspense fallback={<div className="min-h-dvh bg-surface" />}>
      <GalleryPage
        onBack={() => {
          void navigate({ to: "/" });
        }}
      />
    </Suspense>
  );
}
