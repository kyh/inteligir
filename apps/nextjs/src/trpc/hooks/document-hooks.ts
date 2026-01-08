"use client";

import { produce } from "immer";
import { useCallback } from "react";

import { useDebouncedCallback } from "@/hooks/useDebounceCallback";
import { useWarnIfUnsavedChanges } from "@/hooks/useWarnIfUnsavedChanges";
import { mergeDefined } from "@/lib/mergeDefined";
import { api, useTRPC } from "@/trpc/react";

export const useUpdateDocumentMutation = () => {
  const trpc = useTRPC();

  return api.document.update.useMutation({
    onError: (_err, _vars, context) => {
      const ctx = context as {
        id?: string;
        previousDocument?: unknown;
        previousDocuments?: unknown;
      } | undefined;
      if (ctx?.previousDocuments) {
        trpc.document.documents.setData({}, ctx.previousDocuments as Parameters<typeof trpc.document.documents.setData>[1]);
      }
      if (ctx?.previousDocument && ctx?.id) {
        trpc.document.document.setData(
          { id: ctx.id },
          ctx.previousDocument as Parameters<typeof trpc.document.document.setData>[1]
        );
      }
    },
    onMutate: async (input) => {
      await trpc.document.documents.cancel();
      await trpc.document.document.cancel({ id: input.id });

      const previousDocuments = trpc.document.documents.getData({});
      const previousDocument = trpc.document.document.getData({ id: input.id });

      trpc.document.document.setData({ id: input.id }, (old) =>
        produce(old, (draft) => {
          if (!draft?.document) return draft;

          draft.document = {
            ...mergeDefined(input, draft.document, {
              omitNull: true,
            }),
          };
        })
      );

      trpc.document.documents.setData({}, (old) =>
        produce(old, (draft) => {
          if (!draft) return draft;

          draft.documents = draft.documents.map((document) => {
            if (document.id === input.id) {
              return mergeDefined(input, document, { omitNull: true });
            }

            return document;
          });
        })
      );

      return { id: input.id, previousDocument, previousDocuments };
    },
  });
};

export const useUpdateDocumentTitle = () => {
  const updateDocument = useUpdateDocumentMutation();
  const trpc = useTRPC();

  const updateDocumentDebounced = useDebouncedCallback(
    updateDocument.mutate,
    500
  );

  return useCallback(
    (input: { id: string; title: string }) => {
      updateDocumentDebounced({
        id: input.id,
        title: input.title,
      });

      const currentDocument = trpc.document.document.getData({ id: input.id });
      const parentDocumentId = currentDocument?.document?.parentDocumentId;

      void Promise.all([
        trpc.document.document.setData({ id: input.id }, (prevData) =>
          produce(prevData, (draft) => {
            if (draft?.document) {
              draft.document = {
                ...mergeDefined(input, draft.document, {
                  omitNull: true,
                }),
              };
            }
          })
        ),
        trpc.document.documents.setData({}, (prevData) =>
          produce(prevData, (draft) => {
            if (!draft) return draft;

            draft.documents = draft.documents.map((document) => {
              if (document.id === input.id) {
                return mergeDefined(input, document, { omitNull: true });
              }

              return document;
            });
          })
        ),
        parentDocumentId
          ? trpc.document.documents.setData({ parentDocumentId }, (prevData) =>
              produce(prevData, (draft) => {
                if (!draft) return draft;

                draft.documents = draft.documents.map((document) => {
                  if (document.id === input.id) {
                    return mergeDefined(input, document, { omitNull: true });
                  }

                  return document;
                });
              })
            )
          : Promise.resolve(),
      ]);
    },
    [trpc, updateDocumentDebounced]
  );
};

export const useArchiveDocumentMutation = () => {
  const trpc = useTRPC();

  return api.document.archive.useMutation({
    onError: (_err, _vars, context) => {
      const ctx = context as {
        id?: string;
        previousDocument?: unknown;
        previousDocuments?: unknown;
      } | undefined;
      if (ctx?.previousDocuments) {
        trpc.document.documents.setData({}, ctx.previousDocuments as Parameters<typeof trpc.document.documents.setData>[1]);
      }
      if (ctx?.previousDocument && ctx?.id) {
        trpc.document.document.setData(
          { id: ctx.id },
          ctx.previousDocument as Parameters<typeof trpc.document.document.setData>[1]
        );
      }
    },
    onMutate: async (input) => {
      await trpc.document.documents.cancel();
      await trpc.document.document.cancel({ id: input.id });

      const previousDocuments = trpc.document.documents.getData({});
      const previousDocument = trpc.document.document.getData({ id: input.id });

      trpc.document.documents.setData({}, (old) =>
        produce(old, (draft) => {
          if (!draft) return draft;

          draft.documents = draft.documents.filter(
            (document) => document.id !== input.id
          );
        })
      );

      trpc.document.document.setData({ id: input.id }, (old) =>
        produce(old, (draft) => {
          if (!draft?.document) return draft;

          draft.document.isArchived = true;
        })
      );

      return { id: input.id, previousDocument, previousDocuments };
    },
    onSuccess: () => {
      void trpc.document.documents.invalidate();
    },
  });
};

export const useUpdateDocumentValue = () => {
  const trpc = useTRPC();
  const updateDocument = useUpdateDocumentMutation();
  const updateDocumentDebounced = useDebouncedCallback(
    updateDocument.mutate,
    500
  );

  useWarnIfUnsavedChanges({ enabled: updateDocumentDebounced.isPending() });

  return useCallback(
    (input: { id: string; value: unknown }) => {
      updateDocumentDebounced({
        id: input.id,
        contentRich: input.value,
      });

      void trpc.document.document.setData({ id: input.id }, (prevData) =>
        produce(prevData, (draft) => {
          if (draft?.document) {
            draft.document.contentRich = input.value;
          }
        })
      );
    },
    [trpc, updateDocumentDebounced]
  );
};
