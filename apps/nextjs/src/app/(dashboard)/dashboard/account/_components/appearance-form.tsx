"use client";

import Image from "next/image";
import { RadioGroup, RadioGroupItem } from "@repo/ui/radio-group";
import { useTheme } from "@repo/ui/theme";
import { Check, Minus } from "lucide-react";

const items = [
  {
    id: "radio-light",
    value: "light",
    label: "Light",
    image: "/profile/ui-light.webp",
  },
  {
    id: "radio-dark",
    value: "dark",
    label: "Dark",
    image: "/profile/ui-dark.webp",
  },
  {
    id: "radio-system",
    value: "system",
    label: "System",
    image: "/profile/ui-system.webp",
  },
];

export const AppearanceForm = () => {
  const { theme, setTheme } = useTheme();

  const onChange = (value: string) => {
    setTheme(value);
  };

  return (
    <RadioGroup
      className="flex gap-5"
      onValueChange={onChange}
      defaultValue={theme}
    >
      {items.map((item) => (
        <label key={item.id}>
          <RadioGroupItem
            id={item.id}
            value={item.value}
            className="peer sr-only after:absolute after:inset-0"
          />
          <Image
            src={item.image}
            alt={item.label}
            width={120}
            height={120}
            className="border-input ring-offset-background peer-[:focus-visible]:ring-ring/70 peer-data-[state=checked]:border-ring peer-data-[state=checked]:bg-accent relative overflow-hidden rounded-lg border shadow-sm shadow-black/[.04] transition-colors peer-[:focus-visible]:ring-2 peer-[:focus-visible]:ring-offset-2 peer-data-[disabled]:cursor-not-allowed peer-data-[disabled]:opacity-50"
          />
          <span className="peer-data-[state=unchecked]:text-muted-foreground/70 group mt-2 flex items-center gap-1">
            <Check
              size={16}
              strokeWidth={2}
              className="peer-data-[state=unchecked]:group-[]:hidden"
              aria-hidden="true"
            />
            <Minus
              size={16}
              strokeWidth={2}
              className="peer-data-[state=checked]:group-[]:hidden"
              aria-hidden="true"
            />
            <span className="text-xs font-medium">{item.label}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
};
