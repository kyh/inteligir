// The agents' sign-ins as hooks, so ⌘K, the panel, Settings and onboarding read one status and run
// one sign-in: the server runs a single sign-in at a time, and every surface shows that one.

import { harnessReadiness } from "@repo/api/local/agents/agents-schema";
import type {
  AgentsSignInCodeResponse,
  AgentsStatusResponse,
  HarnessStatus,
} from "@repo/api/local/agents/agents-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { failed, orpc, refusalMessage } from "../api";
import { useSystemStatus } from "../vault-hooks";

// the vendor prints its address a moment after it starts, and the browser may finish any time.
const SIGN_IN_POLL_MS = 1000;

// A sign-in can change outside this app, so each surface that mounts asks the vendors again; while a
// sign-in runs, here or started elsewhere, the status is polled for its address and its end.
export const useAgentsStatus = (signingInHere = false) =>
  useQuery({
    ...orpc.agents.status.queryOptions(),
    refetchInterval: (query) =>
      signingInHere || (query.state.data?.signingIn ?? null) !== null ? SIGN_IN_POLL_MS : false,
    staleTime: 0,
  });

// The harness an action would run on when it needs a sign-in first: `id` is a thread's own, null
// the default a new action starts on. Only the ACP runtime asks a vendor, so a scripted or
// disabled agent never needs one, and a vendor that did not answer is not called signed out.
export const useSignedOutHarness = (id: string | null): HarnessStatus | null => {
  const runtime = useSystemStatus().data?.agent.runtime;
  const status = useAgentsStatus().data;
  if (runtime !== "acp" || status === undefined) {
    return null;
  }
  const wanted = id ?? status.defaultId;
  const harness = status.harnesses.find((candidate) => candidate.id === wanted);
  return harness !== undefined && harnessReadiness(harness) === "signed-out" ? harness : null;
};

export interface SignInWaiting {
  harness: HarnessStatus;
  // the address the vendor printed for a browser that did not open; null until it prints one
  authUrl: string | null;
  // the sign-in also takes the code that address's page shows
  acceptsCode: boolean;
}

interface SignInFailure {
  id: string;
  detail: string;
}

type SignInCodeAnswer = AgentsSignInCodeResponse["outcome"];

export interface AgentSignInFlow {
  status: AgentsStatusResponse | undefined;
  // the one sign-in the server runs, whichever surface started it
  waiting: SignInWaiting | null;
  // the last sign-in this surface started, when it did not end signed in
  failure: SignInFailure | null;
  start: (id: string, onSignedIn?: () => void) => void;
  cancel: () => void;
  submitCode: (code: string) => void;
  code: { pending: boolean; answer: SignInCodeAnswer | null; refusal: string | null };
}

export const useAgentSignIn = (): AgentSignInFlow => {
  const queryClient = useQueryClient();
  const statusKey = orpc.agents.status.queryKey();

  // a poll still in flight when the sign-in ends would put back the status from before it.
  const replaceStatus = async (next: AgentsStatusResponse | null): Promise<void> => {
    await queryClient.cancelQueries({ queryKey: statusKey });
    if (next === null) {
      await queryClient.invalidateQueries({ queryKey: statusKey });
    } else {
      queryClient.setQueryData(statusKey, next);
    }
  };

  const signIn = useMutation(
    orpc.agents.signIn.mutationOptions({
      onError: async () => {
        await replaceStatus(null);
      },
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.system.status.key() });
      },
      onSuccess: async (answer) => {
        await replaceStatus(answer.status);
      },
    }),
  );
  const cancel = useMutation(
    orpc.agents.cancelSignIn.mutationOptions({
      onError: (cause) => {
        failed(cause, "Could not stop signing in.");
      },
      onSuccess: async (status) => {
        await replaceStatus(status);
      },
    }),
  );
  const code = useMutation(orpc.agents.submitSignInCode.mutationOptions());

  const status = useAgentsStatus(signIn.isPending).data;
  const running = status?.signingIn ?? null;
  const startedId = signIn.isPending ? signIn.variables.id : null;
  const waitingId = running?.id ?? startedId;
  const waitingHarness =
    waitingId === null
      ? undefined
      : status?.harnesses.find((candidate) => candidate.id === waitingId);
  const waiting: SignInWaiting | null =
    waitingHarness === undefined
      ? null
      : {
          acceptsCode: running?.id === waitingHarness.id && running.acceptsCode,
          authUrl: running?.id === waitingHarness.id ? running.authUrl : null,
          harness: waitingHarness,
        };

  const failure = ((): SignInFailure | null => {
    switch (signIn.status) {
      case "error": {
        return {
          detail: refusalMessage(signIn.error, "Could not start signing in."),
          id: signIn.variables.id,
        };
      }
      case "success": {
        return signIn.data.outcome === "failed"
          ? { detail: signIn.data.detail, id: signIn.variables.id }
          : null;
      }
      default: {
        return null;
      }
    }
  })();

  return {
    cancel: () => {
      if (waitingId !== null) {
        cancel.mutate({ id: waitingId });
      }
    },
    code: {
      answer: code.data?.outcome ?? null,
      pending: code.isPending,
      refusal: code.isError ? refusalMessage(code.error, "Could not send the code.") : null,
    },
    failure: waiting === null ? failure : null,
    start: (id, onSignedIn) => {
      code.reset();
      signIn.mutate(
        { id },
        {
          onSuccess: (answer) => {
            if (answer.outcome === "signed-in") {
              onSignedIn?.();
            }
          },
        },
      );
    },
    status,
    submitCode: (pasted) => {
      if (waitingId !== null) {
        code.mutate({ code: pasted, id: waitingId });
      }
    },
    waiting,
  };
};
