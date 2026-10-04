// Under the macOS shell the window has no title bar and the traffic lights sit over the
// page's top-left corner (`TitleBarStyle::Overlay` in src-tauri/src/window.rs), so the page
// reserves that corner and draws the strip that drags the window. A plain browser tab has its
// own chrome and reserves nothing.
export const hasInsetTitleBar = (): boolean =>
  window.desktopBridge !== undefined && /mac/iu.test(navigator.userAgent);
