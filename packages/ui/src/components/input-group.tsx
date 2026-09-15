"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

// Fluid's input group: a stack of labelled fields the pointer travels between. It is not a field
// wearing an addon — that was the shadcn component this replaces, whose last consumer was the
// palette's framed search field, and Fluid's field is frameless. Here the group is the unit: the
// proximity hover picks the nearest field as the pointer approaches, the picked field lifts its
// fill and its ring, and its label and icon thicken with it.
//
// The label is drawn twice in one grid cell — an invisible semibold copy under the visible one —
// so the row reserves the wider of the two weights and nothing reflows when the weight animates.

import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { Field } from "@base-ui/react/field";

import { cn } from "@repo/ui/lib/cn";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { fontWeights } from "@repo/ui/lib/font-weight";
import type { IconComponent } from "@repo/ui/lib/icon";
import { useProximityHover } from "@repo/ui/hooks/use-proximity-hover";
import { useRadius } from "@repo/ui/lib/radius-context";
import { SizeProvider, useSize } from "@repo/ui/lib/size-context";
import type { SizeVariant } from "@repo/ui/lib/size-context";
import { useIsoLayoutEffect } from "@repo/ui/lib/use-iso-layout-effect";

interface InputGroupContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
}

const InputGroupContext = createContext<InputGroupContextValue | null>(null);

const useInputGroup = (): InputGroupContextValue => {
  const ctx = useContext(InputGroupContext);
  if (!ctx) {
    throw new Error("InputField must render inside <InputGroup>");
  }
  return ctx;
};

interface InputGroupProps extends ComponentProps<"div"> {
  children: ReactNode;
  // pins every field in the group to one step of the ladder; omitted, they follow the ambient one
  size?: SizeVariant;
}

const InputGroup = ({ children, size, className, ref, ...props }: InputGroupProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { activeIndex, handlers, registerItem } = useProximityHover(containerRef);
  const {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onMouseMove: handleMouseMove,
  } = handlers;

  const ctx = useMemo(() => ({ activeIndex, registerItem }), [activeIndex, registerItem]);

  const group = (
    <InputGroupContext.Provider value={ctx}>
      <div
        ref={composeRefs(containerRef, ref)}
        data-slot="input-group"
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        // `relative` makes this the fields' offsetParent: the proximity hook measures them by
        // offsetTop and compares against container-relative pointer coords, so both coordinate
        // spaces must share this origin, as in every other consumer.
        className={cn("relative flex w-72 max-w-full flex-col gap-3", className)}
        {...props}
      >
        {children}
      </div>
    </InputGroupContext.Provider>
  );

  return size === undefined ? group : <SizeProvider size={size}>{group}</SizeProvider>;
};

interface InputFieldProps extends Omit<
  ComponentProps<"input">,
  "onChange" | "value" | "size" | "type"
> {
  label: string;
  // keeps the label for assistive tech without drawing it — for an inline field (a toolbar
  // search) where the placeholder carries the meaning
  labelHidden?: boolean;
  icon?: IconComponent;
  // the field's place in the group, which is the proximity hook's index space
  index: number;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  disabled?: boolean;
  fieldRef?: RefObject<HTMLDivElement | null>;
}

// what a field is wearing: its fill, and the ring around it
interface FieldTone {
  bg: string;
  ring: string;
}

// the tone by what the field is doing: disabled, refused, focused, approached, at rest
const fieldTone = ({
  disabled,
  error,
  isFocused,
  isActive,
}: {
  disabled: boolean;
  error: boolean;
  isFocused: boolean;
  isActive: boolean;
}): FieldTone => {
  if (disabled) {
    return { bg: "bg-transparent", ring: "ring-border" };
  }
  if (error) {
    if (isFocused) {
      return { bg: "bg-card", ring: "ring-destructive/50" };
    }
    // Fluid tints the approached error field with its own `destructive-light`; this palette has
    // one destructive hue, so the tint is that hue at the weight the token would have carried.
    return {
      bg: isActive ? "bg-destructive/10" : "bg-transparent",
      ring: isActive ? "ring-destructive/50" : "ring-transparent",
    };
  }
  if (isFocused) {
    return { bg: "bg-card", ring: "ring-border" };
  }
  if (isActive) {
    return { bg: "bg-muted/50", ring: "ring-border" };
  }
  return { bg: "bg-transparent", ring: "ring-transparent" };
};

const InputField = ({
  label,
  labelHidden = false,
  icon: Icon,
  index,
  value,
  onChange,
  error,
  disabled = false,
  className,
  fieldRef,
  ...props
}: InputFieldProps) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { registerItem, activeIndex } = useInputGroup();
  const [isFocused, setIsFocused] = useState(false);
  const radius = useRadius();
  const sizeClasses = useSize();
  const compact = sizeClasses.variant === "compact";

  useIsoLayoutEffect(() => {
    registerItem(index, rowRef.current);
    return () => {
      registerItem(index, null);
    };
  }, [registerItem, index]);

  const isActive = activeIndex === index;
  // the label and the icon follow the field, whichever way it became live
  const labelActive = isActive || isFocused;
  const tone = fieldTone({ disabled, error: error !== undefined, isActive, isFocused });

  return (
    // Base UI's Field wires the accessibility plumbing: Label's htmlFor targets the control,
    // Error's generated id lands in the control's aria-describedby, and `invalid` drives
    // aria-invalid and data-invalid.
    <Field.Root
      ref={composeRefs(rowRef, fieldRef)}
      invalid={error !== undefined}
      disabled={disabled}
      data-slot="input-field"
      className={cn(
        "flex cursor-text flex-col gap-1",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <Field.Label
        className={cn(
          labelHidden ? "sr-only" : "inline-grid",
          sizeClasses.text,
          // one notch tighter than the ladder's control padding: the field's ring is invisible at
          // rest, so the roomier inset reads as a gap rather than an indent
          !labelHidden && (compact ? "pl-2" : "pl-2.5"),
        )}
      >
        {/* the wider weight, reserved: the visible copy can thicken without moving anything */}
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {label}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 transition-colors duration-80",
            error === undefined ? "text-muted-foreground" : "text-destructive",
          )}
          style={{
            fontVariationSettings: labelActive ? fontWeights.semibold : fontWeights.normal,
          }}
        >
          {label}
        </span>
      </Field.Label>

      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- click-to-focus affordance for the input inside, which owns the keyboard path */}
      <div
        onMouseDown={(event) => {
          // a click anywhere in the field — the icon, the padding — focuses the input, without
          // disturbing the input's own caret placement
          if (event.target === inputRef.current) {
            return;
          }
          event.preventDefault();
          inputRef.current?.focus();
        }}
        className={cn(
          // fixed height rather than padding around the line box, so the field sits exactly on
          // the ladder's control height
          "flex items-center ring-1 transition-all duration-80",
          sizeClasses.control,
          sizeClasses.gap,
          radius.input,
          compact ? "px-2" : "px-2.5",
          tone.bg,
          tone.ring,
        )}
      >
        {Icon === undefined ? null : (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={labelActive ? 2 : 1.5}
            className={cn(
              "shrink-0 transition-[color,stroke-width] duration-80",
              labelActive ? "text-foreground" : "text-muted-foreground",
            )}
          />
        )}
        <Field.Control
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onFocus={() => {
            setIsFocused(true);
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          // rounded-none: the global :focus-visible rule hands a focused element the shape radius,
          // and a text input clips its caret to its corners
          className={cn(
            "w-full rounded-none bg-transparent font-[inherit] text-foreground outline-none placeholder:text-muted-foreground",
            sizeClasses.text,
          )}
          style={{ fontVariationSettings: fontWeights.normal }}
          {...props}
        />
      </div>

      {error === undefined ? null : (
        // `match` pins it visible while the controlled `error` prop stands
        <Field.Error
          match
          className={cn("text-destructive", compact ? "pl-2" : "pl-2.5", "text-caption")}
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {error}
        </Field.Error>
      )}
    </Field.Root>
  );
};

export { InputField, InputGroup };
