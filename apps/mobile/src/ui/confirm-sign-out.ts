import { Alert } from "react-native";
import { logout } from "@/lib/app-runtime";

const unsentLine = (edits: number): string =>
  edits === 1
    ? "1 change on this phone has not reached your library yet."
    : `${String(edits)} changes on this phone have not reached your library yet.`;

// a sign-out that would discard edits the library has not taken asks first, naming how many
export const confirmSignOut = async (): Promise<void> => {
  const outcome = await logout();
  if (outcome.kind === "signed-out") {
    return;
  }
  Alert.alert(
    "Sign out and discard them?",
    `${unsentLine(outcome.edits)} Signing out discards them.`,
    [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          void logout({ discardUnsent: true });
        },
        style: "destructive",
        text: "Discard and sign out",
      },
    ],
  );
};
