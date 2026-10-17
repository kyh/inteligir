// Settings › Library's way to the browser extension: where a person who has only the app learns
// that a save can start in the browser, and gets it.

import { EXTENSION_STORE_URL } from "@repo/contract/browser/extension-identity";

import { Row } from "./settings-chrome";

export const BrowserExtensionRow = () => (
  <Row label="Browser">
    <span className="flex flex-col items-start gap-1">
      <a
        href={EXTENSION_STORE_URL}
        target="_blank"
        rel="noreferrer"
        className="text-body underline-offset-2 hover:underline"
      >
        Get the Inteligir extension
      </a>
      <span className="text-body text-muted-foreground">
        Save the page you&apos;re on from Chrome, Arc, Brave, Edge or Vivaldi with one click.
      </span>
    </span>
  </Row>
);
