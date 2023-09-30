import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";

import { PlusIcon } from "../icons";
import { IconButton } from "../components/icon-button";

const meta: Meta<typeof IconButton> = {
  title: "Components/IconButton",
  component: IconButton,
  parameters: {
    layout: "centered",
  },
};

export default meta;

type Story = StoryObj<typeof IconButton>;

export const BasePrimary: Story = {
  args: {
    variant: "primary",
    size: "md",
    children: <PlusIcon />,
  },
};

export const BaseTransparent: Story = {
  args: {
    variant: "transparent",
    size: "md",
    children: <PlusIcon />,
  },
};

export const LargePrimary: Story = {
  args: {
    variant: "primary",
    size: "lg",
    children: <PlusIcon />,
  },
};

export const LargeTransparent: Story = {
  args: {
    variant: "transparent",
    size: "lg",
    children: <PlusIcon />,
  },
};

export const XLargePrimary: Story = {
  args: {
    variant: "primary",
    size: "xl",
    children: <PlusIcon />,
  },
};

export const XLargeTransparent: Story = {
  args: {
    variant: "transparent",
    size: "xl",
    children: <PlusIcon />,
  },
};

export const Disabled: Story = {
  args: {
    variant: "primary",
    size: "md",
    children: <PlusIcon />,
    disabled: true,
  },
};

export const IsLoading: Story = {
  args: {
    variant: "primary",
    size: "md",
    children: <PlusIcon />,
    isLoading: true,
  },
};
