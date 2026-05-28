import type { ThreeElements } from "@react-three/fiber";

/* react-three-fiber ships a `declare module 'react'` JSX augmentation, but it
   doesn't reach `React.JSX` under this project's `jsx: "preserve"` + React 19
   types setup, so r3f intrinsics (group, mesh, …) don't resolve. Re-declare
   the augmentation here (where it's part of the program) against both the
   global and `react` JSX namespaces, plus the custom `line2` element
   registered via extend(). */
interface R3FElements extends ThreeElements {
  line2: {
    children?: React.ReactNode;
  };
}

declare global {
  namespace JSX {
    interface IntrinsicElements extends R3FElements {}
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements extends R3FElements {}
  }
}

/* CanvasProps `extends React.HTMLAttributes<HTMLDivElement>`, but that clause
   conflicts with r3f's RenderProps event handlers under TS6, so the inherited
   DOM attributes (className, …) get dropped. Re-add the one the orb passes. */
declare module "@react-three/fiber" {
  interface CanvasProps {
    className?: string;
  }
}

export {};
