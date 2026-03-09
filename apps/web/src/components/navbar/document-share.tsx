"use client";

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { useTParams } from "@/hooks/use-navigation";
import { useOrigin } from "@/hooks/useOrigin";
import { useCopyToClipboard } from "@/registry/hooks/use-copy-to-clipboard";
import { useMounted } from "@/registry/hooks/use-mounted";
import { Button, LinkButton } from "@/registry/ui/button";
import { Input } from "@/registry/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/registry/ui/tabs";
import { useUpdateDocumentMutation } from "@/trpc/hooks/document-hooks";
import { useDocumentQueryOptions } from "@/trpc/hooks/query-options";
import { useAuthGuard } from "../auth/useAuthGuard";
import { Icons } from "../ui/icons";

export const DocumentShare = () => {
  const mounted = useMounted();
  const authGuard = useAuthGuard();
  const { documentId } = useTParams<"/dashboard/[slug]/[documentId]">();
  const { data: isPublished } = useQuery({
    ...useDocumentQueryOptions(),
    select: (data) => data.document?.isPublished,
  });

  const origin = useOrigin();
  const updateDocument = useUpdateDocumentMutation();
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  const url = `${origin}/preview/${documentId!}`;

  const copyUrl = () => {
    copyToClipboard(url);
  };

  //
  const onPublish = () => {
    const promise = updateDocument.mutateAsync({
      id: documentId!,
      isPublished: true,
    });

    toast.promise(promise, {
      error: "Failed to publish note!",
      loading: "Publishing...",
      success: "Note published.",
    });
  };

  const onUnpublish = () => {
    const promise = updateDocument.mutateAsync({
      id: documentId!,
      isPublished: false,
    });

    toast.promise(promise, {
      error: "Failed to unpublish note!",
      loading: "Unpublishing...",
      success: "Note unpublished.",
    });
  };

  if (!mounted) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="relative" variant="ghost">
          <Users className="mr-2 size-4" />
          Collaborate
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" alignOffset={8} className="w-80">
        <Tabs defaultValue="publish">
          <TabsList>
            <TabsTrigger value="publish">Publish</TabsTrigger>
          </TabsList>

          <TabsContent value="publish">
            {isPublished ? (
              <div className="space-y-4 p-3">
                <div className="relative">
                  <Input
                    className="h-8 w-full flex-1 truncate border bg-muted pr-[32px] pl-2 text-muted-foreground"
                    readOnly
                    value={url}
                  />
                  <Button
                    className="absolute top-1 right-1"
                    disabled={isCopied}
                    onClick={copyUrl}
                    size="menuAction"
                    variant="menuAction"
                  >
                    {isCopied ? (
                      <Icons.check variant="muted" />
                    ) : (
                      <Icons.copyLink variant="muted" />
                    )}
                  </Button>
                </div>
                <div className="flex items-center justify-center gap-x-2 px-3">
                  <Button
                    className="font-medium"
                    disabled={updateDocument.isPending}
                    onClick={() => authGuard(onUnpublish)}
                    size="md"
                    variant="outline"
                  >
                    Unpublish
                  </Button>
                  <LinkButton href={url} size="md" target="_blank" variant="brand">
                    View site
                  </LinkButton>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-5">
                <p className="font-semibold">Publish to web</p>
                <span className="mt-1 text-muted-foreground text-sm">
                  Share your document with others
                </span>

                <Button
                  className="mt-4 w-full"
                  disabled={updateDocument.isPending}
                  onClick={() => authGuard(onPublish)}
                  variant="brand"
                >
                  Publish
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
};
