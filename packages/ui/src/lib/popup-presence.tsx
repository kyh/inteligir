"use client";

// CLAUDE.md § A POPUP'S MOTION RIDES ITS POPUP ELEMENT. Base UI's path for a Motion popup that
// leaves the DOM when it closes (base-ui.com/react/handbook/animation): the Root is controlled, its
// Portal renders under AnimatePresence while the Root is open and is kept mounted, and the Popup
// renders as the motion element with an exit of its own. Motion starts a presence exit in the
// closing commit's layout effects, ahead of the frame in which Base UI looks for the Popup's
// animations, so the opacity it fades is running when Base UI looks, and AnimatePresence lets the
// popup go once every exit under it is done.

import { AnimatePresence } from "motion/react";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const PopupOpenContext = createContext(false);

// the Root's open, handed to the part under it that draws the popup
export const PopupOpen = ({ open, children }: { open: boolean; children: ReactNode }) => (
  <PopupOpenContext value={open}>{children}</PopupOpenContext>
);

// a Portal with `keepMounted`, rendered while the Root is open and through its exit
export const PopupPresence = ({ children }: { children: ReactNode }) => {
  const open = useContext(PopupOpenContext);
  return <AnimatePresence>{open ? children : null}</AnimatePresence>;
};
