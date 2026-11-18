import { connection } from "next/server";

import { LibraryRoot } from "#library/library-root";

import "#library/styles/globals.css";

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
