import { Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { login, signUp, useLoginState, useSession } from "@/lib/app-runtime";
import { useTheme } from "@/lib/theme";
import type { Palette } from "@/lib/palette";
import { TextButton } from "@/ui/text-button";

// a value, not a class: className draws nothing on a SafeAreaView
const screenOf = (theme: Palette) =>
  ({
    alignItems: "center",
    backgroundColor: theme.background,
    flex: 1,
    justifyContent: "center",
  }) as const;

const FIELD_CLASS =
  "rounded-lg border border-input bg-card px-4 py-3 text-16 text-foreground placeholder:text-muted-foreground";

type Door = "sign-in" | "sign-up";

const SignInScreen = () => {
  const theme = useTheme();
  const session = useSession();
  const signIn = useLoginState();
  const [door, setDoor] = useState<Door>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const busy = signIn.kind === "signing-in";
  const creating = door === "sign-up";
  const ready =
    email.trim() !== "" &&
    password !== "" &&
    (!creating || (name.trim() !== "" && inviteCode.trim() !== ""));
  const reason =
    (session.kind === "signed-out" ? session.notice : null) ??
    (creating
      ? "Create your account with the invite code you were sent."
      : "Sign in with your account to see and edit your library.");

  return (
    <SafeAreaView style={screenOf(theme)}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <View className="gap-3 self-stretch px-6">
        <Text className="text-30 font-bold text-foreground">inteligir</Text>
        <Text className="text-center text-16 text-muted-foreground">{reason}</Text>
        {creating ? (
          <TextInput
            className={FIELD_CLASS}
            placeholder="Name"
            value={name}
            onChangeText={setName}
            textContentType="name"
            editable={!busy}
          />
        ) : null}
        <TextInput
          className={FIELD_CLASS}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          editable={!busy}
        />
        <TextInput
          className={FIELD_CLASS}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType={creating ? "newPassword" : "password"}
          editable={!busy}
        />
        {creating ? (
          <TextInput
            className={FIELD_CLASS}
            placeholder="Invite code"
            value={inviteCode}
            onChangeText={setInviteCode}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
        ) : null}
        {signIn.kind === "failed" ? (
          <Text className="text-14 text-destructive">{signIn.message}</Text>
        ) : null}
        <Pressable
          className="mt-2 items-center rounded-lg bg-primary px-6 py-3 active:opacity-80 disabled:opacity-50"
          disabled={busy || !ready}
          onPress={() => {
            void (creating
              ? signUp({ email, inviteCode, name, password })
              : login({ email, password }));
          }}
        >
          {busy ? (
            <ActivityIndicator color={theme.primaryForeground} />
          ) : (
            <Text className="text-16 font-semibold text-primary-foreground">
              {creating ? "Create account" : "Sign in"}
            </Text>
          )}
        </Pressable>
        <View className="items-center pt-2">
          <TextButton
            fontSize={14}
            label={creating ? "I have an account" : "Create an account"}
            onPress={() => {
              setDoor(creating ? "sign-in" : "sign-up");
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

export default SignInScreen;
