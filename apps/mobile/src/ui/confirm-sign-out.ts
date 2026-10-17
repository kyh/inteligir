import { Alert } from "react-native";
import { logout } from "@/lib/app-runtime";

const unsentLines = (edits: number, requests: number): string[] => {
  const lines: string[] = [];
  if (edits > 0) {
    lines.push(
      edits === 1
        ? "1 change on this phone has not reached your library yet."
        : `${String(edits)} changes on this phone have not reached your library yet.`,
    );
  }
  if (requests > 0) {
    lines.push(
      requests === 1
        ? "1 request to your Mac has not reached it yet."
        : `${String(requests)} requests to your Mac have not reached it yet.`,
    );
  }
  return lines;
};

// a sign-out that would discard edits the library has not taken, or requests no Mac holds yet,
// asks first, naming how many
export const confirmSignOut = async (): Promise<void> => {
  const outcome = await logout();
  if (outcome.kind === "signed-out") {
    return;
  }
  Alert.alert(
    "Sign out and discard them?",
    [...unsentLines(outcome.edits, outcome.requests), "Signing out discards them."].join(" "),
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
