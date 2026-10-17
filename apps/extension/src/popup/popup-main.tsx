// the toolbar's popup: it saves the active tab on open and says where it landed (§8.6).

import { cn } from "@repo/ui/lib/cn";
import { createRoot } from "react-dom/client";
import "../styles/globals.css";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the popup has no #root to mount into");
}

// PIVOT-STUB(X): an empty popup until the save and its outcomes land (§8.6)
createRoot(container).render(<main className={cn("w-80 bg-background")} />);
