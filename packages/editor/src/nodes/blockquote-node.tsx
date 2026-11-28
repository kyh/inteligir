import type { ComponentType } from "react";
import {
  InfoCircle as InfoIcon,
  Lightbulb02 as LightbulbIcon,
  AlertOctagon as OctagonAlertIcon,
  AlertSquare as ShieldAlertIcon,
  AlertTriangle as TriangleAlertIcon,
} from "@untitledui/icons";
import { PlateElement, useReadOnly } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { ALERT_VARIANTS, alertVariantSchema } from "@repo/contract/library/library-nodes";
import type { AlertVariant } from "@repo/contract/library/library-nodes";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { cn } from "@repo/ui/lib/cn";

import { alertProp } from "@repo/editor/headless/node-props";
import { lockHolds } from "@repo/editor/nodes/rich-block-lock";

interface AlertPresentation {
  Icon: ComponentType<{ className?: string }>;
  accent: string;
  icon: string;
  label: string;
}

const ALERTS = {
  CAUTION: {
    Icon: OctagonAlertIcon,
    accent: "border-red-500/60 bg-red-500/[0.05]",
    icon: "text-red-600 dark:text-red-400",
    label: "Caution",
  },
  IMPORTANT: {
    Icon: ShieldAlertIcon,
    accent: "border-violet-500/60 bg-violet-500/[0.05]",
    icon: "text-violet-600 dark:text-violet-400",
    label: "Important",
  },
  NOTE: {
    Icon: InfoIcon,
    accent: "border-blue-500/60 bg-blue-500/[0.05]",
    icon: "text-blue-600 dark:text-blue-400",
    label: "Note",
  },
  TIP: {
    Icon: LightbulbIcon,
    accent: "border-emerald-500/60 bg-emerald-500/[0.05]",
    icon: "text-emerald-600 dark:text-emerald-400",
    label: "Tip",
  },
  WARNING: {
    Icon: TriangleAlertIcon,
    accent: "border-amber-500/60 bg-amber-500/[0.05]",
    icon: "text-amber-600 dark:text-amber-400",
    label: "Warning",
  },
} satisfies Record<AlertVariant, AlertPresentation>;

export const BlockquoteElement = (props: PlateElementProps) => {
  const readOnly = useReadOnly();
  const { editor, element } = props;
  const alert = alertProp(element);

  if (alert === undefined) {
    return <PlateElement {...props} as="blockquote" />;
  }

  const { Icon, accent, icon, label } = ALERTS[alert];

  return (
    <PlateElement
      {...props}
      as="blockquote"
      className={cn("rounded-md border-l-[3px] py-2 pr-3 pl-4 [&>*]:my-0", accent)}
    >
      <DropdownMenu disabled={readOnly || lockHolds(editor, element)}>
        <DropdownMenuTrigger
          contentEditable={false}
          className={cn(
            "flex w-fit items-center gap-1.5 py-[3px] text-subtitle leading-[1.3] font-semibold select-none enabled:cursor-pointer",
            icon,
          )}
        >
          <Icon className="size-4" />
          {label}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup
            value={alert}
            onValueChange={(value) => {
              const picked = alertVariantSchema.safeParse(value);
              const at = editor.api.findPath(element);

              if (picked.success && at) {
                editor.tf.setNodes({ alert: picked.data }, { at });
              }
            }}
          >
            {ALERT_VARIANTS.map((variant) => (
              <DropdownMenuRadioItem key={variant} value={variant}>
                {ALERTS[variant].label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {props.children}
    </PlateElement>
  );
};
