"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

// Motion's own default is "never", which plays every transform straight through the OS's
// reduce-motion setting. "user" drops the travel (transforms, and left/top/width/height) and keeps
// the opacity fades, which are also what Base UI waits on before it unmounts a closing popup.
export const MotionPolicy = ({ children }: { children: ReactNode }) => (
  <MotionConfig reducedMotion="user">{children}</MotionConfig>
);
