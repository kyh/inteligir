"use client";

import React from "react";

import { Cover } from "@/components/cover/cover";
import { DocumentToolbar } from "@/components/cover/document-toolbar";
import { PlateEditor } from "@/components/editor/plate-editor";
import { useTemplateDocument } from "@/components/editor/utils/useTemplateDocument";
import { LinkButton } from "@/registry/ui/button";

export function PublicDocumentClient() {
  const template = useTemplateDocument();

  if (!template) {
    return (
      <div className="mt-[12vh] flex min-h-screen flex-col items-center pt-[12vh]">
        <div className="text-[64px]">👀</div>
        <h1 className="mb-4 font-medium text-lg">This page does not exist</h1>
        <LinkButton href="/" size="md" variant="brand">
          Back to my content
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Cover />
      <div className="flex w-full flex-1 flex-col">
        <DocumentToolbar />
        <PlateEditor />
      </div>
    </div>
  );
}
