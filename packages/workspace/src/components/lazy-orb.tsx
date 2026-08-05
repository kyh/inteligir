import { lazy, Suspense, type ComponentProps } from "react";

// three + @react-three/fiber are the renderer's heaviest dependencies and the
// orb is the only consumer; loading it on demand keeps WebGL out of the main
// bundle. The fallback is empty on purpose — the orb fades in on its own.
const Orb = lazy(() =>
  import("@repo/ui/components/geometric-orb").then((m) => ({ default: m.GeometricOrb })),
);

export function LazyGeometricOrb(props: ComponentProps<typeof Orb>) {
  return (
    <Suspense fallback={null}>
      <Orb {...props} />
    </Suspense>
  );
}
