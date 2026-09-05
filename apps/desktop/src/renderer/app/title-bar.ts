// Under the macOS shell the window has no title bar and the traffic lights sit over the
// page's top-left corner (`titleBarStyle: "hiddenInset"` in src/main/index.ts), so the page
// reserves that corner. A plain browser tab has its own chrome and reserves nothing.
export function hasInsetTitleBar(): boolean {
  return window.desktopBridge !== undefined && /mac/iu.test(navigator.userAgent);
}
