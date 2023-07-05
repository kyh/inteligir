import { createClassed } from "@tw-classed/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => {
  return twMerge(clsx(inputs));
};

export const { classed } = createClassed({ merger: twMerge });
