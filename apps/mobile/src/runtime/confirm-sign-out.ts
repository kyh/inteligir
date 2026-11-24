import { Alert } from "react-native";
import type { AppRuntime, LogoutOutcome } from "./compose-runtime";

const waitingLine = (saves: number) =>
  saves === 1
    ? "1 save on this iPhone has not reached your library yet. Signing out discards it."
    : `${String(saves)} saves on this iPhone have not reached your library yet. Signing out discards them.`;

const saidIfFailed = (outcome: LogoutOutcome) => {
  if (outcome.kind === "failed") {
    Alert.alert("Couldn't sign out", outcome.message);
  }
};

export const confirmSignOut = async (runtime: Pick<AppRuntime, "logout">) => {
  const outcome = await runtime.logout();

  if (outcome.kind !== "waiting") {
    saidIfFailed(outcome);

    return;
  }

  Alert.alert("Sign out and discard saves waiting?", waitingLine(outcome.saves), [
    { style: "cancel", text: "Cancel" },
    {
      onPress: () => {
        void (async () => {
          saidIfFailed(await runtime.logout({ discardWaiting: true }));
        })();
      },
      style: "destructive",
      text: "Discard and sign out",
    },
  ]);
};
