import { Pressable, Text } from "react-native";
import { SPACE } from "@/lib/theme";

const SIZE_CLASS = {
  14: "text-14",
  16: "text-16",
} as const;

export const TextButton = ({
  fontSize,
  label,
  onPress,
}: {
  fontSize: keyof typeof SIZE_CLASS;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    className="active:opacity-70"
    hitSlop={SPACE.sm}
    onPress={onPress}
  >
    <Text className={`font-semibold text-foreground ${SIZE_CLASS[fontSize]}`}>{label}</Text>
  </Pressable>
);
