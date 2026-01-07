"use client";

import { useEditorScrollRef } from "platejs/react";

import { SearchCommand } from "@/components/search/search-command";

export function Main({ children }: { children: React.ReactNode }) {
  const ref = useEditorScrollRef();

  return (
    <main
      className="relative h-[calc(100vh-44px-2px)] overflow-y-auto"
      id="scroll_container"
      ref={ref}
    >
      <SearchCommand />
      {children}
    </main>
  );
}
