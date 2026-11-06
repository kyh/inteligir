// A sign-out takes the library off this iPhone, so one that would discard changes the library has
// not taken asks first, naming how many, and one the phone could not finish says why.

import { Alert } from "react-native";
import { logout } from "@/lib/app-runtime";
import type { LogoutOutcome } from "@/lib/compose-runtime";

const unsentLine = (edits: number): string =>
  edits === 1
    ? "1 change on this iPhone has not reached your library yet. Signing out discards it."
    : `${String(edits)} changes on this iPhone have not reached your library yet. Signing out discards them.`;

const saidIfFailed = (outcome: LogoutOutcome): void => {
  if (outcome.kind === "failed") {
    Alert.alert("Couldn't sign out", outcome.message);
  }
};

export const confirmSignOut = async (): Promise<void> => {
  const outcome = await logout();
  if (outcome.kind !== "unsent") {
    saidIfFailed(outcome);
    return;
  }
  Alert.alert("Sign out and discard unsent changes?", unsentLine(outcome.edits), [
    { style: "cancel", text: "Cancel" },
    {
      onPress: () => {
        void (async () => {
          saidIfFailed(await logout({ discardUnsent: true }));
        })();
      },
      style: "destructive",
      text: "Discard and sign out",
    },
  ]);
};
