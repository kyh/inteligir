import { Pressable, StyleSheet, Text } from "react-native";
import { SPACE, useTheme } from "@/lib/theme";

const styles = StyleSheet.create({
  label: { fontWeight: "600" },
  pressed: { opacity: 0.7 },
});

// a label that acts, with no frame of its own; the size is the caller's, set to the text it sits by
export const TextButton = ({
  fontSize,
  label,
  onPress,
}: {
  fontSize: number;
  label: string;
  onPress: () => void;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={SPACE.sm}
      style={({ pressed }) => pressed && styles.pressed}
      onPress={onPress}
    >
      <Text style={[styles.label, { color: theme.foreground, fontSize }]}>{label}</Text>
    </Pressable>
  );
};
