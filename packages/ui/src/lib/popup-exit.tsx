"use client";

import { flushKeyframeResolvers } from "framer-motion";
import { useEffect } from "react";
import type { ReactNode } from "react";

// Base UI unmounts a closing popup once the Popup element's own animations finish, and it looks one
// frame after the close. framer resolves a declarative animation on its own next frame, after that
// look, so left alone the popup unmounts before its exit begins. A parent's effect runs after its
// child's, where framer queued the exit, so resolving here starts it in the closing commit: a
// running opacity animation on the Popup when Base UI looks, which it then waits out.
export const PopupExit = ({ exiting, children }: { exiting: boolean; children: ReactNode }) => {
  useEffect(() => {
    if (exiting) {
      flushKeyframeResolvers();
    }
  }, [exiting]);
  return children;
};
