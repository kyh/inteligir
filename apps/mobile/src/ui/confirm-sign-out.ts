// A sign-out takes the library off this iPhone, so one that would discard changes the library has
// not taken asks first, naming how many.

import { Alert } from "react-native";
import { logout } from "@/lib/app-runtime";

const unsentLine = (edits: number): string =>
  edits === 1
    ? "1 change on this iPhone has not reached your library yet. Signing out discards it."
    : `${String(edits)} changes on this iPhone have not reached your library yet. Signing out discards them.`;

export const confirmSignOut = async (): Promise<void> => {
  const outcome = await logout();
  if (outcome.kind === "signed-out") {
    return;
  }
  Alert.alert("Sign out and discard them?", unsentLine(outcome.edits), [
    { style: "cancel", text: "Cancel" },
    {
      onPress: () => {
        void logout({ discardUnsent: true });
      },
      style: "destructive",
      text: "Discard and sign out",
    },
  ]);
};
