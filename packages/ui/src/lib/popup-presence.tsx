"use client";

import { AnimatePresence } from "motion/react";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const PopupOpenContext = createContext(false);

export const PopupOpen = ({ open, children }: { open: boolean; children: ReactNode }) => (
  <PopupOpenContext value={open}>{children}</PopupOpenContext>
);

export const PopupPresence = ({ children }: { children: ReactNode }) => {
  const open = useContext(PopupOpenContext);

  return <AnimatePresence>{open ? children : null}</AnimatePresence>;
};
