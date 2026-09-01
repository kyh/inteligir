// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
