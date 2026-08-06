import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useHostStatus } from "@/lib/host/connection";
import { hostStatusDotColor, hostStatusLabel } from "@/lib/host/status-display";
import { RADIUS, SPACE, useTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// The home surface. This app is a COMPANION to a desktop host: everything it
// can do runs over the paired connection, so the home screen is the connection
// itself — its live status, and the way into the two surfaces a paired desktop
// serves (chat and the delegation dock).
//
// Unpaired, the only useful action is pairing, so that is the whole screen.
// ---------------------------------------------------------------------------

export default function Index() {
  const theme = useTheme();
  const router = useRouter();
  const { status } = useHostStatus();
  const paired = status !== "none";

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.foreground }]}>inteligir</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: hostStatusDotColor(status) }]} />
            <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>
              {hostStatusLabel(status)}
            </Text>
          </View>
        </View>

        {paired ? (
          <View style={styles.actions}>
            <PrimaryAction label="Chat" onPress={() => router.push("/chat")} />
            <PrimaryAction label="Delegations" onPress={() => router.push("/delegations")} />
            <SecondaryAction label="Connection" onPress={() => router.push("/connect")} />
          </View>
        ) : (
          <View style={styles.actions}>
            <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>
              Pair with your desktop to chat with its agent and watch its delegations.
            </Text>
            <PrimaryAction label="Pair with your desktop" onPress={() => router.push("/connect")} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function PrimaryAction({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: theme.primary },
        pressed && styles.pressed80,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.buttonLabel, { color: theme.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryAction({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.secondaryButton,
        { borderColor: theme.border, backgroundColor: theme.card },
        pressed && styles.pressed70,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.buttonLabel, { color: theme.cardForeground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: "center", gap: SPACE.xl, paddingHorizontal: SPACE.xxl },
  header: { gap: SPACE.sm },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { height: 8, width: 8, borderRadius: RADIUS.full },
  actions: { gap: SPACE.md },
  primaryButton: { alignItems: "center", borderRadius: RADIUS.md, paddingVertical: SPACE.md },
  secondaryButton: {
    alignItems: "center",
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingVertical: SPACE.md,
  },
  title: { fontSize: 30, fontWeight: "700" },
  bodyText: { fontSize: 16 },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  pressed70: { opacity: 0.7 },
  pressed80: { opacity: 0.8 },
});
