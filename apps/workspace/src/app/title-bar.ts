// Under the macOS shell the window has no title bar and the traffic lights sit over the page's
// top-left corner (`TitleBarStyle::Overlay` in src-tauri/src/window.rs), so the page keeps that
// corner clear and draws what drags the window. A browser tab has its own chrome, and the shell on
// Linux its own title bar, so neither reserves anything.

import { underShell } from "../shell/shell-commands";

export const hasInsetTitleBar = (): boolean => underShell() && /mac/iu.test(navigator.userAgent);
