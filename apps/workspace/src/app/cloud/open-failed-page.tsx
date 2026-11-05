// The Mac's window when the shell could not open the library at all: a Keychain that refused or is
// locked, a replica file that would not open, a config the shell could not give. Nothing else is
// drawn yet, so this says what failed in the person's words and offers the two ways on: Try again,
// a reload, and Sign out, which lets go of this Mac's credential, its copy of the library and its
// files, and opens on the sign-in. The library itself stays in the account.

import { Button } from "@repo/ui/components/button";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { shellCredential } from "../../shell/shell-commands";
import { shellTroubleText } from "./shell-trouble";

const HEADING = "Your library didn't open";
const OPEN_FAILED = "Something went wrong opening your library on this Mac.";
const SIGNING_OUT =
  "Signing out removes the copy on this Mac, with any change it hasn't sent yet. Your library stays in your account.";

const OpenFailed = ({ cause, reload }: { cause: unknown; reload: () => void }) => {
  const signOut = useMutation({
    mutationFn: async () => {
      await shellCredential.forget();
    },
    // the shell's own work, which needs no connection
    networkMode: "always",
    onSuccess: reload,
  });
  return (
    <main className="flex min-h-dvh items-center justify-center p-8" data-tauri-drag-region>
      <div className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-display font-semibold">{HEADING}</h1>
          <p className="m-0 text-body text-muted-foreground">
            {shellTroubleText(cause, OPEN_FAILED)}
          </p>
        </div>
        <p className="m-0 text-body text-muted-foreground">{SIGNING_OUT}</p>
        {signOut.isError ? (
          <p className="m-0 text-body text-destructive">
            {shellTroubleText(signOut.error, "This Mac couldn't sign out. Try again.")}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button type="button" onClick={reload}>
            Try again
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={signOut.isPending}
            onClick={() => {
              signOut.mutate();
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
};

export const OpenFailedPage = ({
  cause,
  queryClient,
  reload,
}: {
  cause: unknown;
  queryClient: QueryClient;
  // the page opened again from the start: the library, or the sign-in once signed out
  reload: () => void;
}) => (
  <QueryClientProvider client={queryClient}>
    <OpenFailed cause={cause} reload={reload} />
  </QueryClientProvider>
);
