import type { SyntheticEvent } from "react";

export const landedInside = (event: SyntheticEvent) =>
  event.target instanceof Node && event.currentTarget.contains(event.target);
