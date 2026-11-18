"use client";

import { MotionPolicy } from "@repo/ui/lib/motion-policy";

import { ThemeProvider } from "./theme-provider";

export const SiteProviders = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <MotionPolicy>{children}</MotionPolicy>
  </ThemeProvider>
);
