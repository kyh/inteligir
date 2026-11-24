import { Alert } from "react-native";
import { logout } from "@/runtime/app-runtime";
import type { LogoutOutcome } from "@/runtime/compose-runtime";

const waitingLine = (saves: number) =>
  saves === 1
    ? "1 save on this iPhone has not reached your library yet. Signing out discards it."
    : `${String(saves)} saves on this iPhone have not reached your library yet. Signing out discards them.`;

const saidIfFailed = (outcome: LogoutOutcome) => {
  if (outcome.kind === "failed") {
    Alert.alert("Couldn't sign out", outcome.message);
  }
};

export const confirmSignOut = async () => {
  const outcome = await logout();

  if (outcome.kind !== "waiting") {
    saidIfFailed(outcome);

    return;
  }

  Alert.alert("Sign out and discard saves waiting?", waitingLine(outcome.saves), [
    { style: "cancel", text: "Cancel" },
    {
      onPress: () => {
        void (async () => {
          saidIfFailed(await logout({ discardWaiting: true }));
        })();
      },
      style: "destructive",
      text: "Discard and sign out",
    },
  ]);
};
