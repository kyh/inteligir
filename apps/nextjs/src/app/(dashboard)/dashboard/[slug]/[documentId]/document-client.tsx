"use client";

import { useQuery } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import React from "react";

import { Cover } from "@/components/cover/cover";
import { DocumentToolbar } from "@/components/cover/document-toolbar";
import { DocumentSkeleton } from "@/components/document-skeleton";
import { PlateEditor } from "@/components/editor/plate-editor";
import { isTemplateDocument } from "@/components/editor/utils/useTemplateDocument";
import { useTParams } from "@/hooks/use-navigation";
import { LinkButton } from "@/registry/ui/button";
import { useDocumentQueryOptions } from "@/trpc/hooks/query-options";

export function DocumentClient() {
  const { documentId, slug } = useTParams<"/dashboard/[slug]/[documentId]">();
  const { data: id, isLoading } = useQuery({
    ...useDocumentQueryOptions(),
    select: (data) => data.document?.id,
  });
  const shouldRedirect = documentId && isTemplateDocument(documentId) && id;

  if (shouldRedirect) {
    redirect(`/dashboard/${slug}/${id}`);
  }
  if (isLoading) {
    return <DocumentSkeleton />;
  }
  if (!id) {
    return (
      <div className="mt-[12vh] flex min-h-screen flex-col items-center pt-[12vh]">
        <div className="text-[64px]">👀</div>
        <h1 className="mb-4 font-medium text-lg">
          This document does not exist
        </h1>
        <LinkButton href={`/dashboard/${slug}`} size="md" variant="brand">
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
