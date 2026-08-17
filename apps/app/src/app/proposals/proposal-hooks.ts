// The workspace's read of a doc's suggested edits, and the two verbs over
// them.
//
// A proposal is QUERY STATE, unlike the note's own bytes — several surfaces
// read the same list (the editor's gutter, the doc bar, the thread dock), and
// the ws bus invalidates it on `proposals-changed`. That is the whole reason
// the change kind exists separately from `content-changed`: an accept moves
// both, a reject moves only this, and a client that could not tell them apart
// would re-read a file to learn about a row.

import type { Proposal } from "@repo/server-contract/proposals";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError, queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";

export function useDocProposals(docPath: string | null): UseQueryResult<Proposal[]> {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.proposalsByDoc(docPath ?? ""),
    enabled: docPath !== null,
    queryFn: async () => {
      if (docPath === null) {
        return [];
      }
      const response = await unwrap(await api.proposals.list.$get({ query: { docPath } }));
      return response.proposals;
    },
  });
}

export function useThreadProposals(threadId: string | null): UseQueryResult<Proposal[]> {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.proposalsByThread(threadId ?? ""),
    enabled: threadId !== null,
    queryFn: async () => {
      if (threadId === null) {
        return [];
      }
      const response = await unwrap(await api.proposals.list.$get({ query: { threadId } }));
      return response.proposals;
    },
  });
}

interface ProposalVerbArgs {
  proposalId: string;
  /** The revision the caller's hunks came from; the server refuses a stale one. */
  expectedRevision: number;
  /** Omitted resolves the whole suggestion. */
  hunkIndex?: number;
}

export interface ProposalActions {
  accept: (args: ProposalVerbArgs) => Promise<void>;
  reject: (args: ProposalVerbArgs) => Promise<void>;
  /** True while either verb is in flight — both buttons disable together, so
   *  a double click cannot send a second verb at a revision the first moved. */
  pending: boolean;
}

/**
 * Both verbs, with the refusal messages the server writes surfaced verbatim —
 * a 409 here is the whole point of the CAS, and paraphrasing it would lose the
 * distinction between "the file moved" and "the suggestion moved".
 */
export function useProposalActions(onError: (message: string) => void): ProposalActions {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();

  const run = useCallback(
    async (verb: "accept" | "reject", args: ProposalVerbArgs): Promise<void> => {
      const json = {
        proposalId: args.proposalId,
        expectedRevision: args.expectedRevision,
        ...(args.hunkIndex === undefined ? {} : { hunkIndex: args.hunkIndex }),
      };
      try {
        await unwrap(
          verb === "accept"
            ? await api.proposals.accept.$post({ json })
            : await api.proposals.reject.$post({ json }),
        );
      } catch (error) {
        onError(
          error instanceof ApiError ? error.message : `The suggestion could not be ${verb}ed.`,
        );
      } finally {
        // Whatever happened, this client's view of the row is now a guess.
        void queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot });
      }
    },
    [api, onError, queryClient],
  );

  const mutation = useMutation({
    mutationFn: ({ verb, args }: { verb: "accept" | "reject"; args: ProposalVerbArgs }) =>
      run(verb, args),
  });

  return {
    accept: (args) => mutation.mutateAsync({ verb: "accept", args }),
    reject: (args) => mutation.mutateAsync({ verb: "reject", args }),
    pending: mutation.isPending,
  };
}
