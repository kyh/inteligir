// A text field with its label beside it, on the one label width the account form, the delete
// dialog and Connectors share, so their fields line up.

import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import type { ComponentProps } from "react";

export const LabelledField = ({
  id,
  label,
  ...input
}: { label: string } & ComponentProps<typeof Input>) => (
  <div className="flex items-center gap-2">
    <Label htmlFor={id} className="w-24 shrink-0 text-body">
      {label}
    </Label>
    <Input id={id} {...input} />
  </div>
);
