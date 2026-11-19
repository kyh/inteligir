"use client";

import dynamic from "next/dynamic";

export const LibraryRoot = dynamic(async () => await import("./library-layout"), { ssr: false });
