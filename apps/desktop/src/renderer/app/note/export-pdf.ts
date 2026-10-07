// A print is light whatever the window shows: a printer skips backgrounds, so the dark theme's light
// ink would land on white paper. Every host fires `beforeprint` before it lays a print out and
// `afterprint` once it is done (a browser around `window.print()`, WebKit around the shell's print
// sheet), so the theme steps aside between the two, however the print began.
//
// Export as PDF is a print under the note's title, because the title is the suggested file name.
// The shell's print is a sheet that outlives the call, so the title comes back on `afterprint`.

import { toast } from "@repo/ui/components/sonner";

export const installLightPrints = (): (() => void) => {
  const root = document.documentElement;
  let wasDark = false;
  const before = (): void => {
    wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
  };
  const after = (): void => {
    if (wasDark) {
      root.classList.add("dark");
    }
  };
  window.addEventListener("beforeprint", before);
  window.addEventListener("afterprint", after);
  return () => {
    window.removeEventListener("beforeprint", before);
    window.removeEventListener("afterprint", after);
  };
};

// WKWebView answers no `window.print()`, so under the shell the shell prints the window
const printWindow = async (): Promise<string | null> => {
  const bridge = window.desktopBridge;
  if (bridge === undefined) {
    window.print();
    return null;
  }
  const answer = await bridge.print();
  return answer.ok ? null : answer.reason;
};

export const exportNoteAsPdf = async (title: string): Promise<void> => {
  const previousTitle = document.title;
  const restore = (): void => {
    document.title = previousTitle;
  };
  if (title.trim() !== "") {
    document.title = title;
  }
  window.addEventListener("afterprint", restore, { once: true });
  let refusal: string | null;
  try {
    refusal = await printWindow();
  } catch (error) {
    console.warn("[export] the print did not start", error);
    refusal = "The print did not start.";
  }
  if (refusal !== null) {
    window.removeEventListener("afterprint", restore);
    restore();
    toast.error(refusal);
  }
};
