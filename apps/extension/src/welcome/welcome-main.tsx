// the page the extension opens once installed: it says hello to the Mac's native host and names
// the library it reached, or links the download (§8.6).

import { cn } from "@repo/ui/lib/cn";
import { createRoot } from "react-dom/client";
import "../styles/globals.css";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the welcome page has no #root to mount into");
}

// PIVOT-STUB(X): an empty page until the hello and its answer land (§8.6)
createRoot(container).render(<main className={cn("min-h-screen bg-background")} />);
