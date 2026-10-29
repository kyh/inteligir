import { Pressable, Text } from "react-native";
import { SPACE } from "@/lib/theme";

// each size's class written out whole: Tailwind makes a class only where its full name is in a
// source, so one assembled from parts would draw nothing
const SIZE_CLASS = {
  13: "text-13",
  14: "text-14",
  16: "text-16",
} as const;

// a label that acts, with no frame of its own; the size is the caller's, set to the text it sits by
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
