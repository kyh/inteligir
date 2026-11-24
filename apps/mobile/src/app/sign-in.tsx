import { Stack } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLoginState, useRuntime, useSession } from "@/runtime/runtime-context";
import { screenStyle, useTheme } from "@/lib/theme";
import { formReady, returnOf } from "@/login/sign-in-fields";
import type { SignInDoor, SignInField } from "@/login/sign-in-fields";
import { TextButton } from "@/ui/text-button";

const FIELD_CLASS =
  "rounded-lg border border-input bg-card px-4 py-3 text-16 text-foreground placeholder:text-muted-foreground";

type ReturnProps = Pick<TextInputProps, "onSubmitEditing" | "returnKeyType" | "submitBehavior">;

const SignInScreen = () => {
  const runtime = useRuntime();
  const theme = useTheme();
  const session = useSession();
  const signIn = useLoginState();
  const [door, setDoor] = useState<SignInDoor>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const nameInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const inviteCodeInput = useRef<TextInput>(null);
  const busy = signIn.kind === "signing-in";
  const creating = door === "sign-up";
  const ready = formReady(door, { email, inviteCode, name, password });

  const reason =
    (session.kind === "signed-out" ? session.notice : null) ??
    (creating
      ? "Create your account with the invite code you were sent."
      : "Sign in with your account to see and edit your library.");

  const send = () => {
    if (busy || !ready) {
      return;
    }

    void (creating
      ? runtime.login.signUp({ email, inviteCode, name, password })
      : runtime.login.login({ email, password }));
  };

  const focus = (field: SignInField) => {
    const inputs = {
      email: emailInput,
      inviteCode: inviteCodeInput,
      name: nameInput,
      password: passwordInput,
    };

    inputs[field].current?.focus();
  };

  const returnProps = (field: SignInField) => {
    const next = returnOf(door, field);

    return (
      next.kind === "next"
        ? {
            onSubmitEditing: () => {
              focus(next.field);
            },
            returnKeyType: "next",
            submitBehavior: "submit",
          }
        : { onSubmitEditing: send, returnKeyType: "go", submitBehavior: "blurAndSubmit" }
    ) satisfies ReturnProps;
  };

  return (
    <SafeAreaView style={screenStyle(theme)}>
      <Stack.Screen options={{ title: "inteligir" }} />
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          contentContainerClassName="grow justify-center"
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-3 px-6">
            <Text className="text-30 font-bold text-foreground">inteligir</Text>
            <Text className="text-center text-16 text-muted-foreground">{reason}</Text>
            {creating ? (
              <TextInput
                ref={nameInput}
                className={FIELD_CLASS}
                accessibilityLabel="Name"
                placeholder="Name"
                value={name}
                onChangeText={setName}
                textContentType="name"
                editable={!busy}
                {...returnProps("name")}
              />
            ) : null}
            <TextInput
              ref={emailInput}
              className={FIELD_CLASS}
              accessibilityLabel="Email"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              editable={!busy}
              {...returnProps("email")}
            />
            <TextInput
              ref={passwordInput}
              className={FIELD_CLASS}
              accessibilityLabel="Password"
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType={creating ? "newPassword" : "password"}
              editable={!busy}
              {...returnProps("password")}
            />
            {creating ? (
              <TextInput
                ref={inviteCodeInput}
                className={FIELD_CLASS}
                accessibilityLabel="Invite code"
                placeholder="Invite code"
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                {...returnProps("inviteCode")}
              />
            ) : null}
            {signIn.kind === "failed" ? (
              <Text className="text-14 text-destructive">{signIn.message}</Text>
            ) : null}
            <Pressable
              className="mt-2 items-center rounded-lg bg-primary px-6 py-3 active:opacity-80 disabled:opacity-50"
              disabled={busy || !ready}
              onPress={send}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default SignInScreen;
