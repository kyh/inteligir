import { Alert } from "react-native";
import { logout } from "@/lib/app-runtime";

const unsentLine = (edits: number): string =>
  edits === 1
    ? "1 change on this phone has not reached your library yet. Signing out discards it."
    : `${String(edits)} changes on this phone have not reached your library yet. Signing out discards them.`;

const unreadLine = (unread: number): string =>
  unread === 1
    ? "1 link you saved here hasn't been read yet, and stays unread until you choose Refresh from the page on a Mac."
    : `${String(unread)} links you saved here haven't been read yet, and stay unread until you choose Refresh from the page on a Mac.`;

// a sign-out that would discard edits the library has not taken, or leave links this phone saved
// unread, asks first, naming how many
export const confirmSignOut = async (): Promise<void> => {
  const outcome = await logout();
  if (outcome.kind === "signed-out") {
    return;
  }
  const lines = [
    ...(outcome.edits > 0 ? [unsentLine(outcome.edits)] : []),
    ...(outcome.unread > 0 ? [unreadLine(outcome.unread)] : []),
  ];
  Alert.alert(
    outcome.edits > 0 ? "Sign out and discard them?" : "Sign out before they're read?",
    lines.join(" "),
    [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          void logout({ discardUnsent: true });
        },
        style: "destructive",
        text: outcome.edits > 0 ? "Discard and sign out" : "Sign out",
      },
    ],
  );
};
