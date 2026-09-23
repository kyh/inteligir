import { renderInertPage } from "./inert-page";

// every way in, since a tab cannot tell which one its user has: a spent link, a restarted server
// and a bookmark all land here alike.
export const SIGNED_OUT_PAGE = renderInertPage({
  detail:
    'A browser signs in through a one-time link, and this tab holds no sign-in this server accepts: the link was already used or expired, or the server restarted. Run "inteligir open" in a terminal, or choose Help → Open in Browser in the desktop app.',
  title: "This tab is signed out",
});
