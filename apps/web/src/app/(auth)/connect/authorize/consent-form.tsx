"use client";

import { useId } from "react";
import { z } from "zod";

import type { ConsentRequest } from "@repo/service/auth/consent-request";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";

import { AuthError, AuthShell, fieldValue, useAuthSubmit } from "#components/auth-shell";
import { authClient, authErrorMessage } from "#lib/auth-client";

type Ask = Extract<ConsentRequest, { readonly kind: "ask" }>;

const describedSchema = z.object({ error_description: z.string().min(1) });

const allowedScope = (ask: Ask, readOnly: boolean) =>
  [
    ...(readOnly ? ["library:read"] : ask.scopes),
    ...(ask.offlineAccess ? ["offline_access"] : []),
  ].join(" ");

const Publisher = ({ ask }: { ask: Ask }) =>
  ask.assistant.verifiedDomain === null ? (
    <>
      This assistant named itself, so nothing has checked that name. Access is sent to{" "}
      <strong className="text-foreground [overflow-wrap:anywhere]">{ask.redirectTo}</strong>.
    </>
  ) : (
    <>
      Published by <strong className="text-foreground">{ask.assistant.verifiedDomain}</strong>.
      Access is sent to{" "}
      <strong className="text-foreground [overflow-wrap:anywhere]">{ask.redirectTo}</strong>.
    </>
  );

export const ConsentForm = ({ ask, email }: { ask: Ask; email: string }) => {
  const changes = ask.scopes.includes("library");
  const offersReadOnly = changes && ask.scopes.includes("library:read");
  const { name } = ask.assistant;
  const readOnlyId = useId();

  const { busy, error, onSubmit, ready } = useAuthSubmit(async (form) => {
    const accept = fieldValue(form, "decision") === "allow";

    const { error: failure } = await authClient.oauth2.consent(
      accept
        ? { accept, scope: allowedScope(ask, fieldValue(form, "access") === "read") }
        : { accept },
    );

    if (failure === null) {
      return null;
    }

    return describedSchema.safeParse(failure).data?.error_description ?? authErrorMessage(failure);
  });

  return (
    <AuthShell
      title={
        changes
          ? `Allow ${name} to read and change your library?`
          : `Allow ${name} to read your library?`
      }
      subtitle={`You're signed in as ${email}.`}
      footer="To stop it, Disconnect it in Settings › Account › Connected assistants: its access ends at once."
    >
      <form onSubmit={onSubmit} className="grid gap-4 text-sm">
        <p>
          {changes
            ? `${name} will be able to search and read everything in your library, save links, write notes and change your items.`
            : `${name} will be able to search and read everything in your library.`}
        </p>
        <p className="text-muted-foreground">
          <Publisher ask={ask} />
        </p>
        {ask.loopback ? (
          <p role="note" className="rounded-lg border border-border p-3">
            <strong>This sends access to an app on this computer.</strong> Allow it only if you just
            started connecting from that app.
          </p>
        ) : null}
        {offersReadOnly ? (
          <div className="flex items-center gap-2">
            <Checkbox id={readOnlyId} name="access" value="read" />
            <label htmlFor={readOnlyId} className="select-none">
              Only let it read the library
            </label>
          </div>
        ) : null}
        <AuthError message={error} />
        <div className="flex gap-2">
          <Button type="submit" name="decision" value="allow" disabled={busy || !ready}>
            Allow
          </Button>
          <Button
            type="submit"
            name="decision"
            value="deny"
            variant="secondary"
            disabled={busy || !ready}
          >
            Don’t allow
          </Button>
        </div>
      </form>
    </AuthShell>
  );
};

export const ConsentRefused = ({ sentence }: { sentence: string }) => (
  <AuthShell title="This didn't connect" subtitle={sentence} footer={null}>
    {null}
  </AuthShell>
);
