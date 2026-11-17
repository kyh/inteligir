"use client";

import dynamic from "next/dynamic";

// The library draws in the browser alone, over the account's library read through /v1, so its
// document is an empty shell and its code a client graph of its own that no site page loads.
export const LibraryRoot = dynamic(async () => await import("./library-layout"), { ssr: false });
