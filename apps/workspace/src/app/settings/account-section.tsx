// Settings › Account: who is signed in, the devices holding the account's credential, the
// assistants let into the library through the connector, the built-in agent's switch, and signing
// out or deleting the account. Each is the account's, kept in the cloud, so each waits for a
// connection; a revoke or a switch refetches only the list it changed, once it has landed.

import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/components/sonner";
import { Switch } from "@repo/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAccount, useReplica, useWire } from "../cloud/library-context";
import { CellAnswer, NEEDS_CONNECTION, refusalText } from "../cloud/needs-connection";
import { forgetPref, PREFS } from "../prefs";
import { relativeTimeLabel, useNow } from "../relative-time";
import { Row, SectionHeading } from "./settings-chrome";

const DevicesRow = () => {
  const { orpc } = useWire();
  const queryClient = useQueryClient();
  const nowMs = useNow();
  const devices = useQuery(orpc.account.devices.list.queryOptions());
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
        {(data) => {
          const live = data.devices.filter((device) => device.revokedAt === null);
          return live.length === 0 ? (
            <span className="text-muted-foreground">No app is signed in yet.</span>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Devices">
              {live.map((device) => (
                <li key={device.id} className="flex items-center gap-2">
                  <span className="truncate">{device.name}</span>
                  <span className="text-caption text-muted-foreground">
                    {device.lastSeenAt === null ? "" : relativeTimeLabel(device.lastSeenAt, nowMs)}
                  </span>
                  <Button
                    size="compact"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`Sign out ${device.name}`}
                    onClick={() => {
                      revoke.mutate({ deviceId: device.id });
                    }}
                  >
                    Sign out
                  </Button>
                </li>
              ))}
            </ul>
          );
        }}
      </CellAnswer>
    </Row>
  );
};

const AssistantsRow = () => {
  const { orpc } = useWire();
  const queryClient = useQueryClient();
  const assistants = useQuery(orpc.account.assistants.list.queryOptions());
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
  const status = useQuery(orpc.library.agent.status.queryOptions());
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
            {setEnabled.isPaused ? (
              <span className="text-caption text-muted-foreground">{NEEDS_CONNECTION}</span>
            ) : null}
          </div>
        )}
      </CellAnswer>
    </Row>
  );
};

const DeleteAccount = () => {
  const { client } = useWire();
  const replica = useReplica();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: async (typed: string) => await client.account.delete({ password: typed }),
    onError: (cause) => {
      toast.error(refusalText(cause, "The account couldn't be deleted."));
    },
    onSuccess: async () => {
      await replica.wipe();
      forgetPref(PREFS.libraryScope);
      window.location.assign("/");
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
  const { client } = useWire();
  const replica = useReplica();
  const signOut = useMutation({
    mutationFn: async () => await client.account.signOut(),
    onError: (cause) => {
      toast.error(refusalText(cause, "Signing out didn't work. Try again."));
    },
    onSuccess: async () => {
      await replica.wipe();
      forgetPref(PREFS.libraryScope);
      window.location.assign("/app/sign-in");
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
        <Row label="">
          <div className="flex flex-col gap-2">
            <Button
              size="compact"
              variant="secondary"
              className="self-start"
              disabled={signOut.isPending}
              onClick={() => {
                void (async () => {
                  const status = replica.status();
                  if (
                    status.unsent > 0 &&
                    !(await confirm({
                      body: "Changes this page hasn't sent yet are lost if you sign out now.",
                      confirmLabel: "Sign out",
                      destructive: true,
                      title: "Sign out before your changes are sent?",
                    }))
                  ) {
                    return;
                  }
                  signOut.mutate();
                })();
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
