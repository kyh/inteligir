// Settings › Account: who is signed in, the devices signed in to the account, the assistants let
// into the library through the connector, the built-in agent's switch and the filing rules it
// follows, and signing out or deleting the account. Each is the account's, kept in the cloud, so
// each waits for a connection; a revoke or a switch refetches only the list it changed, once it
// has landed.

import { FILING_RULES_MAX } from "@repo/contract/cloud/library/library-wire";
import { Button } from "@repo/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/components/sonner";
import { Switch } from "@repo/ui/components/switch";
import { Textarea } from "@repo/ui/components/textarea";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAccount, useLeft, usePageAuth, useWire } from "../cloud/library-context";
import { refusalText } from "@repo/contract/cloud/refusal-text";
import { CellAnswer } from "../cloud/needs-connection";
import type { CloudWire } from "../cloud/v1";
import { relativeTimeLabel, useNow } from "../relative-time";
import { FILING_RULES_TEXT } from "./filing-rules";
import { Row, SectionHeading } from "./settings-chrome";

// what the account's rows read, which Settings' route asks for as it opens: fresh for half a
// minute, so a row drawing what the route asked does not ask the cell again as it mounts
const ACCOUNT_FRESH_MS = 30_000;

export const accountReads = (orpc: CloudWire["orpc"]) => ({
  agent: orpc.library.agent.status.queryOptions({ staleTime: ACCOUNT_FRESH_MS }),
  assistants: orpc.account.assistants.list.queryOptions({ staleTime: ACCOUNT_FRESH_MS }),
  devices: orpc.account.devices.list.queryOptions({ staleTime: ACCOUNT_FRESH_MS }),
});

// this device's own row has no Sign out: it leaves through the account's, which clears its cookie
// too
const DevicesRow = () => {
  const { orpc } = useWire();
  const queryClient = useQueryClient();
  const nowMs = useNow();
  const devices = useQuery(accountReads(orpc).devices);
  const revoke = useMutation(
    orpc.account.devices.revoke.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "That device couldn't be signed out."));
      },
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.account.devices.key() });
      },
    }),
  );
  return (
    <Row label="Devices">
      <CellAnswer query={devices} failed="The devices couldn't be read.">
        {(data) => (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Devices">
            {data.devices.map((device) => (
              <li key={device.id} className="flex items-center gap-2">
                <span className="truncate">{device.name}</span>
                <span className="text-caption text-muted-foreground">
                  {device.lastSeenAt === null ? "" : relativeTimeLabel(device.lastSeenAt, nowMs)}
                </span>
                {device.current ? (
                  <span className="ml-auto text-caption text-muted-foreground">This device</span>
                ) : (
                  <Button
                    size="compact"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`Sign out ${device.name}`}
                    onClick={() => {
                      revoke.mutate({ id: device.id });
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CellAnswer>
    </Row>
  );
};

const AssistantsRow = () => {
  const { orpc } = useWire();
  const queryClient = useQueryClient();
  const assistants = useQuery(accountReads(orpc).assistants);
  const revoke = useMutation(
    orpc.account.assistants.revoke.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "That assistant couldn't be disconnected."));
      },
      onSuccess: async () => {
        toast.success("Disconnected. It can't reach your library anymore.");
        await queryClient.invalidateQueries({ queryKey: orpc.account.assistants.key() });
      },
    }),
  );
  return (
    <Row label="Connected assistants">
      <CellAnswer query={assistants} failed="The connected assistants couldn't be read.">
        {(data) =>
          data.assistants.length === 0 ? (
            <span className="text-muted-foreground">
              None. Claude or ChatGPT can reach your library once you connect it.
            </span>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Connected assistants">
              {data.assistants.map((assistant) => (
                <li key={assistant.grantId} className="flex items-center gap-2">
                  <span className="truncate">{assistant.clientName}</span>
                  <span className="text-caption text-muted-foreground">
                    {assistant.scopes.includes("library") ? "Reads and changes" : "Reads only"}
                  </span>
                  <Button
                    size="compact"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`Disconnect ${assistant.clientName}`}
                    onClick={() => {
                      revoke.mutate({ grantId: assistant.grantId });
                    }}
                  >
                    Disconnect
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      </CellAnswer>
    </Row>
  );
};

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const AgentRow = () => {
  const { orpc } = useWire();
  const queryClient = useQueryClient();
  const status = useQuery(accountReads(orpc).agent);
  const setEnabled = useMutation(
    orpc.library.agent.setEnabled.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "The built-in agent couldn't be switched."));
      },
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.library.agent.status.key() });
      },
    }),
  );
  return (
    <Row label="Built-in agent">
      <CellAnswer query={status} failed="The built-in agent's state couldn't be read.">
        {(data) => (
          <div className="flex flex-col gap-1">
            <Switch
              aria-label="Built-in agent"
              checked={data.enabled}
              disabled={setEnabled.isPending}
              onCheckedChange={(enabled) => {
                setEnabled.mutate({ enabled });
              }}
            />
            <span className="text-caption text-muted-foreground">
              {data.enabled
                ? `${String(data.turnsLeft)} turns left today; more at ${TIME.format(data.resetsAt)}.`
                : "Off: it answers nothing, and your conversations stay readable."}
            </span>
          </div>
        )}
      </CellAnswer>
    </Row>
  );
};

const RulesEditor = ({ initial, onSaved }: { initial: string; onSaved: () => void }) => {
  const { orpc } = useWire();
  const queryClient = useQueryClient();
  const [text, setText] = useState(initial);
  const save = useMutation(
    orpc.library.agent.setRules.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "The filing rules couldn't be saved."));
      },
      onSuccess: async () => {
        toast.success("Saved. The agent follows them from its next answer.");
        await queryClient.invalidateQueries({ queryKey: orpc.library.agent.rules.key() });
        onSaved();
      },
    }),
  );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ rules: text });
      }}
    >
      <Textarea
        aria-label="Filing rules"
        className="min-h-72 font-mono"
        maxLength={FILING_RULES_MAX}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <Button type="submit" className="self-end" disabled={save.isPending}>
        Save
      </Button>
    </form>
  );
};

// the rules the built-in agent follows over its own taste, which Tidy my library files by; the
// starter rules fill the page the first time, until the person saves their own
const FilingRulesRow = () => {
  const { orpc } = useWire();
  const [open, setOpen] = useState(false);
  const rules = useQuery(
    orpc.library.agent.rules.queryOptions({ input: open ? undefined : skipToken }),
  );
  return (
    <Row label="Filing rules">
      <div className="flex flex-col items-start gap-1">
        <Button
          size="compact"
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          Edit filing rules…
        </Button>
        <span className="text-caption text-muted-foreground">
          How the agent files and tags what you save, and what Tidy my library follows.
        </span>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Filing rules</DialogTitle>
          <DialogDescription>
            Write them as you would to a person. The agent reads them in every conversation.
          </DialogDescription>
          <CellAnswer query={rules} failed="The filing rules couldn't be read.">
            {(data) => (
              <RulesEditor
                initial={data.rules ?? FILING_RULES_TEXT}
                onSaved={() => {
                  setOpen(false);
                }}
              />
            )}
          </CellAnswer>
        </DialogContent>
      </Dialog>
    </Row>
  );
};

const DeleteAccount = () => {
  const { client } = useWire();
  const left = useLeft();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: async (typed: string) => await client.account.delete({ password: typed }),
    onError: (cause) => {
      toast.error(refusalText(cause, "The account couldn't be deleted."));
    },
    onSuccess: () => {
      left("deleted");
    },
  });
  return (
    <>
      <Button
        size="compact"
        variant="destructive"
        className="self-start"
        onClick={() => {
          setOpen(true);
        }}
      >
        Delete account…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            Your library, its files, its history and your conversations with the agent are deleted
            from our cloud for good. Type your password to go on.
          </DialogDescription>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (password !== "") {
                remove.mutate(password);
              }
            }}
          >
            <Input
              type="password"
              aria-label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
            <Button
              type="submit"
              variant="destructive"
              disabled={password === "" || remove.isPending}
            >
              Delete everything
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const AccountSection = () => {
  const account = useAccount();
  const auth = usePageAuth();
  const left = useLeft();
  const signOut = useMutation({
    mutationFn: auth.signOut,
    onError: (cause) => {
      toast.error(refusalText(cause, "Signing out didn't work. Try again."));
    },
    onSuccess: () => {
      left("signed-out");
    },
  });
  return (
    <section id="account" className="scroll-mt-10 space-y-2">
      <SectionHeading>Account</SectionHeading>
      <dl className="space-y-3">
        <Row label="Signed in as">
          <span className="select-text">
            {account.name === "" ? account.email : `${account.name} (${account.email})`}
          </span>
        </Row>
        <DevicesRow />
        <AssistantsRow />
        <AgentRow />
        <FilingRulesRow />
        <Row label="">
          <div className="flex flex-col gap-2">
            <Button
              size="compact"
              variant="secondary"
              className="self-start"
              disabled={signOut.isPending}
              onClick={() => {
                signOut.mutate();
              }}
            >
              Sign out
            </Button>
            <DeleteAccount />
          </div>
        </Row>
      </dl>
    </section>
  );
};
