// React hands a portal's events to the portal's React parents, wherever the portal sits in the
// document (react.dev, createPortal: "Events from portals propagate according to the React tree
// rather than the DOM tree"). So a popup a cell opens under <body> bubbles its clicks and keys
// into the cell's handlers and the grid's; a handler that answers only for its own box asks this.
import type { SyntheticEvent } from "react";

export const landedInside = (event: SyntheticEvent): boolean =>
  event.target instanceof Node && event.currentTarget.contains(event.target);
