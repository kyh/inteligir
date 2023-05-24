"use client";

import * as AvatarPrimivite from "@radix-ui/react-avatar";
import { classed } from "@tw-classed/react";

export const Avatar = classed(AvatarPrimivite.Root, {
  base: "relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full",
});

export const AvatarImage = classed(AvatarPrimivite.Image, {
  base: "aspect-square h-full w-full",
});

export const AvatarFallback = classed(AvatarPrimivite.Fallback, {
  base: "flex h-full w-full items-center justify-center rounded-full bg-primary-500 font-semibold uppercase text-white",
});
