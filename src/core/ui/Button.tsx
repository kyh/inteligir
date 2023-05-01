"use client";

import Link from "next/link";
import clsx from "clsx";
import { cva } from "cva";

import If from "~/core/ui/If";
import Spinner from "~/core/ui/Spinner";
import React, { forwardRef } from "react";

type Color = "primary" | "secondary" | "transparent" | "danger" | "custom";
type Size = "normal" | "small" | "large" | "custom";
type Variant = `normal` | `outline` | `flat`;

type Props = React.ButtonHTMLAttributes<unknown> &
  React.PropsWithChildren<{
    block?: boolean;
    round?: boolean;
    color?: Color;
    size?: Size;
    variant?: Variant;
    loading?: boolean;
    href?: Maybe<string>;
  }>;

const classNameBuilder = getClassNameBuilder();
const defaultColor: Color = `primary`;
const defaultSize: Size = `normal`;
const defaultVariant = `normal`;

const Button: React.FCC<Props> = forwardRef<React.ElementRef<"button">, Props>(
  function ButtonComponent(
    { children, color, size, variant, block, loading, round, href, ...props },
    ref
  ) {
    const className = clsx(
      classNameBuilder({
        variant: variant ?? defaultVariant,
        color: color ?? defaultColor,
      }),
      block ? `w-full` : ``,
      loading ? `opacity-70` : ``,
      round ? "rounded-full" : "rounded-md",
      props.className
    );

    const sizesClassName = getSizesClassName()[size ?? defaultSize];

    return (
      <button
        {...props}
        tabIndex={href ? -1 : 0}
        ref={ref}
        className={className}
        disabled={loading || props.disabled}
      >
        <InnerButtonContainerElement href={href}>
          <span
            className={clsx(
              `flex w-full flex-1 items-center justify-center`,
              sizesClassName
            )}
          >
            <If condition={loading}>
              <Animation />
            </If>

            {children}
          </span>
        </InnerButtonContainerElement>
      </button>
    );
  }
);

function Animation() {
  return (
    <span className="mx-2">
      <Spinner className="mx-auto !h-4 !w-4 fill-white dark:fill-white" />
    </span>
  );
}

function InnerButtonContainerElement({
  children,
  href,
}: React.PropsWithChildren<{ href: Maybe<string> }>) {
  if (href) {
    return (
      <Link className="flex w-full items-center" href={href}>
        {children}
      </Link>
    );
  }

  return <span className="flex w-full items-center">{children}</span>;
}

function getClassNameBuilder() {
  return cva(
    [
      `flex items-center justify-center font-medium outline-none transition-all focus:ring-2 ring-offset-1 dark:focus:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-50`,
    ],
    {
      variants: {
        color: {
          primary: `ring-primary-200`,
          secondary: `ring-gray-200`,
          danger: `ring-red-200`,
          transparent: `text-gray-800 focus:ring-2 focus:ring-gray-50 dark:focus:ring-black-300 ring-primary-50 hover:bg-gray-50 active:bg-gray-100 dark:text-gray-300 dark:ring-black-400 dark:hover:bg-black-400 dark:hover:text-white dark:active:bg-black-300`,
          custom: ``,
        },
        variant: {
          normal: ``,
          outline: ``,
          flat: ``,
        },
      },
      compoundVariants: [
        {
          color: "primary",
          variant: "normal",
          className: `bg-primary-500 dark:focus:ring-primary-500/70 text-primary-contrast hover:bg-primary-600 active:bg-primary-700 dark:text-primary-contrast`,
        },
        {
          color: "danger",
          variant: "normal",
          className: `bg-red-400 dark:focus:ring-red-500/70 text-white hover:bg-red-500 active:bg-red-600`,
        },
        {
          color: "secondary",
          variant: "normal",
          className: `bg-gray-100 dark:focus:ring-gray-200 hover:bg-gray-200 active:bg-gray-200 dark:bg-black-300 dark:ring-black-200 dark:hover:bg-black-200 dark:active:bg-black-400`,
        },
        {
          color: "primary",
          variant: "outline",
          className: `border-2 border-primary-500 dark:focus:ring-primary-500/70 bg-transparent text-primary-700`,
        },
        {
          color: "danger",
          variant: "outline",
          className: `border-2 border-red-400 dark:focus:ring-red-500/70 bg-transparent text-red-400`,
        },
        {
          color: "primary",
          variant: "flat",
          className: `bg-primary-500/10 dark:focus:ring-primary-500/70 text-primary-500 hover:bg-primary-500/20 
      active:bg-primary-500/30 dark:hover:bg-primary-500/20 dark:active:bg-primary-500/30`,
        },
        {
          color: "danger",
          variant: "flat",
          className: `bg-red-500/10 text-red-500 dark:focus:ring-red-500/70
    active:bg-red-500/30 hover:bg-red-500/20 dark:active:bg-red-500/30`,
        },
      ],
      defaultVariants: {
        color: "primary",
        variant: "normal",
      },
    }
  );
}

function getSizesClassName() {
  return {
    normal: `text-sm py-2 px-4 h-10`,
    small: `py-2 px-3 text-xs`,
    large: `py-2.5 px-6 h-12 text-lg h-12`,
    custom: ``,
  };
}

export default Button;
