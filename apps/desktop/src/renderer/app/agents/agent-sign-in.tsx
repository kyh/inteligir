// The one sign-in surface: ⌘K over a signed-out agent, the panel's banner, each Settings card and
// onboarding all draw it, so the order, the wording and the waiting state are spelled once.

import { SIGN_IN_CODE_MAX_LENGTH } from "@repo/api/local/agents/agents-schema";
import type { HarnessStatus } from "@repo/api/local/agents/agents-schema";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Spinner } from "@repo/ui/components/spinner";
import { cn } from "@repo/ui/lib/cn";
import { ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { useAgentSignIn } from "./agent-hooks";
import type { AgentSignInFlow, SignInWaiting } from "./agent-hooks";

// a harness this copy did not ship cannot sign in, and one signed in needs nothing.
const canSignIn = (harness: HarnessStatus): boolean =>
  harness.runtime === "bundled" && harness.account.state !== "signed-in";

const codeProblem = (flow: AgentSignInFlow): string | null => {
  if (flow.code.refusal !== null) {
    return flow.code.refusal;
  }
  return flow.code.answer === "incomplete"
    ? "That isn't the whole code. Copy all of it from the sign-in page."
    : null;
};

const PasteCode = ({ flow }: { flow: AgentSignInFlow }) => {
  const fieldId = useId();
  const [code, setCode] = useState("");
  const ready = code.trim() !== "" && !flow.code.pending;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) {
          flow.submitCode(code.trim());
        }
      }}
    >
      <Label htmlFor={fieldId} className="sr-only">
        Code from the sign-in page
      </Label>
      <Input
        id={fieldId}
        autoComplete="off"
        spellCheck={false}
        maxLength={SIGN_IN_CODE_MAX_LENGTH}
        placeholder="Code from the sign-in page"
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
        }}
      />
      <Button type="submit" size="compact" disabled={!ready}>
        Continue
      </Button>
    </form>
  );
};

const Waiting = ({ flow, waiting }: { flow: AgentSignInFlow; waiting: SignInWaiting }) => {
  const [pasting, setPasting] = useState(false);
  const sent = flow.code.answer === "sent";
  const problem = codeProblem(flow);
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-body">
        <Spinner className="size-3.5 text-muted-foreground" />
        {sent ? "Finishing signing in…" : "Finish signing in in your browser."}
      </p>
      {waiting.authUrl === null || sent ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
          <a
            href={waiting.authUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Open the sign-in page
          </a>
          {waiting.acceptsCode && !pasting ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                setPasting(true);
              }}
            >
              Paste the code
            </Button>
          ) : null}
        </div>
      )}
      {pasting && !sent ? <PasteCode flow={flow} /> : null}
      {problem === null ? null : <p className="text-body text-destructive">{problem}</p>}
      <Button
        variant="ghost"
        size="compact"
        onClick={() => {
          flow.cancel();
        }}
      >
        Cancel
      </Button>
    </div>
  );
};

export interface AgentSignInProps {
  // one agent's sign-in alone; absent, the default agent first and the rest under Other
  harness?: string;
  onSignedIn?: (() => void) | undefined;
}

export const AgentSignIn = ({ harness, onSignedIn }: AgentSignInProps) => {
  const flow = useAgentSignIn();
  const [otherOpen, setOtherOpen] = useState(false);
  const { failure, status, waiting } = flow;
  if (status === undefined) {
    return null;
  }
  if (waiting !== null && (harness === undefined || waiting.harness.id === harness)) {
    return <Waiting flow={flow} waiting={waiting} />;
  }

  const offered = status.harnesses.filter(
    (candidate) => canSignIn(candidate) && (harness === undefined || candidate.id === harness),
  );
  // the default leads: a new action runs on it, so its sign-in is the one that unblocks one.
  const first = offered.find((candidate) => candidate.id === status.defaultId) ?? offered[0];
  if (first === undefined) {
    return null;
  }
  const others = offered.filter((candidate) => candidate.id !== first.id);
  const signInButton = (candidate: HarnessStatus, lead: boolean) => (
    <Button
      key={candidate.id}
      size="compact"
      variant={lead ? "primary" : "tertiary"}
      disabled={waiting !== null}
      onClick={() => {
        flow.start(candidate.id, onSignedIn);
      }}
    >
      {failure?.id === candidate.id ? "Try again" : `Sign in with ${candidate.displayName}`}
    </Button>
  );
  const otherShown = otherOpen || others.some((candidate) => candidate.id === failure?.id);

  return (
    <div className="space-y-2">
      {failure === null ? null : <p className="text-body text-destructive">{failure.detail}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {signInButton(first, true)}
        {others.length === 0 ? null : (
          <Button
            variant="ghost"
            size="compact"
            aria-expanded={otherShown}
            leadingIcon={ChevronRightIcon}
            className={cn("[&_svg]:transition-transform", otherShown && "[&_svg]:rotate-90")}
            onClick={() => {
              setOtherOpen(!otherShown);
            }}
          >
            Other
          </Button>
        )}
      </div>
      {otherShown && others.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {others.map((candidate) => signInButton(candidate, false))}
        </div>
      ) : null}
    </div>
  );
};
