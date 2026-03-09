"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { pushModal } from "@/components/modals";
import { useTParams } from "@/hooks/use-navigation";
import { Button } from "@/registry/ui/button";
import { api, useTRPC } from "@/trpc/react";

export const DocumentBanner = () => {
  const { documentId, slug } = useTParams<"/dashboard/[slug]/[documentId]">();
  const router = useRouter();
  const trpc = useTRPC();

  const deleteDocument = api.document.delete.useMutation({
    onSuccess: () => {
      void trpc.document.documents.invalidate();
      void trpc.document.document.invalidate({ id: documentId });
      router.push(`/dashboard/${slug}`);
    },
  });

  const restoreDocument = api.document.restore.useMutation({
    onSuccess: () => {
      void trpc.document.documents.invalidate();
      void trpc.document.document.invalidate({ id: documentId });
    },
  });

  const onRemove = () => {
    const promise = deleteDocument.mutateAsync({ id: documentId });

    toast.promise(promise, {
      error: "Failed to remove Note!",
      loading: "Deleting Note...",
      success: "Note deleted.",
    });
  };

  const onRestore = () => {
    const promise = restoreDocument.mutateAsync({ id: documentId });

    toast.promise(promise, {
      error: "Failed to restore Note!",
      loading: "Restoring Note...",
      success: "Note Restored.",
    });
  };

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-4 bg-destructive px-3 py-2 text-center text-destructive-foreground text-sm">
      <p>This page is in the Trash</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onRestore} variant="primaryOutline">
          Restore page
        </Button>

        <Button
          onClick={() => {
            pushModal("Confirm", {
              name: "page",
              onConfirm: onRemove,
            });
          }}
          variant="primaryOutline"
        >
          Delete from Trash
        </Button>
      </div>
    </div>
  );
};
