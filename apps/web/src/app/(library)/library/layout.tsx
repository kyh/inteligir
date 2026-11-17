import { connection } from "next/server";

import { LibraryRoot } from "#library/library-root";

import "#library/styles/globals.css";

// The library and Settings are one client root, which stays mounted as the tab moves between them
// (src/library/library-history.ts); each page only resolves its address on a reload. The document
// carries proxy.ts's nonce, which a prerendered shell is written without, so it renders per request
// and nothing may suspend above this call.
export const instant = false;

const LibraryLayout = async ({ children }: LayoutProps<"/library">) => {
  await connection();
  return (
    <>
      <LibraryRoot />
      {children}
    </>
  );
};

export default LibraryLayout;
