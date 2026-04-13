import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";

import { useSession, signOut } from "@/lib/auth";
import { useDevices } from "@/lib/use-dispatch";

export default function HomeScreen() {
  const router = useRouter();
  const { data: session, isPending: isSessionLoading } = useSession();
  const { data: devicesData, isLoading: isDevicesLoading, refetch } = useDevices();

  // Redirect to auth if not signed in
  if (!isSessionLoading && !session) {
    router.replace("/auth");
    return null;
  }

  if (isSessionLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#d1684e" />
      </View>
    );
  }

  const devices = devicesData?.devices ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Hello, {session?.user?.name ?? "there"}
        </Text>
        <TouchableOpacity onPress={() => void signOut()}>
          <Text style={styles.signOut}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Your Devices</Text>

      {isDevicesLoading ? (
        <ActivityIndicator color="#d1684e" style={{ marginTop: 20 }} />
      ) : devices.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No devices paired yet.</Text>
          <Text style={styles.emptySubtext}>
            Open the desktop app and pair it with the code shown.
          </Text>
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(d) => d.id}
          style={styles.list}
          onRefresh={() => void refetch()}
          refreshing={isDevicesLoading}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.deviceCard}
              onPress={() =>
                router.push({ pathname: "/dispatch", params: { deviceId: item.id, deviceName: item.name } })
              }
            >
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>{item.name}</Text>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: item.isOnline ? "#22c55e" : "#666" },
                  ]}
                />
              </View>
              <Text style={styles.deviceStatus}>
                {item.isOnline ? "Online" : "Offline"}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity
        style={styles.pairButton}
        onPress={() => router.push("/pair")}
      >
        <Text style={styles.pairButtonText}>+ Pair New Device</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  greeting: {
    fontSize: 20,
    fontWeight: "600",
    color: "#fff",
  },
  signOut: {
    color: "#d1684e",
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#999",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  list: {
    flex: 1,
  },
  deviceCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#333",
  },
  deviceInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  deviceStatus: {
    fontSize: 13,
    color: "#666",
    marginTop: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 18,
    color: "#fff",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    maxWidth: 280,
  },
  pairButton: {
    backgroundColor: "#d1684e",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginBottom: 32,
    marginTop: 16,
  },
  pairButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
