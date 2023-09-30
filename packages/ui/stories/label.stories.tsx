import type { Meta, StoryObj } from "@storybook/react";

import { Label } from "../components/label";

const meta: Meta<typeof Label> = {
  title: "Components/Label",
  component: Label,
  argTypes: {
    size: {
      control: {
        type: "select",
      },
      options: ["sm", "xsmall", "md", "lg"],
    },
    weight: {
      control: {
        type: "select",
      },
      options: ["regular", "plus"],
    },
  },
  parameters: {
    layout: "centered",
  },
};

export default meta;

type Story = StoryObj<typeof Label>;

export const BaseRegular: Story = {
  args: {
    size: "md",
    weight: "regular",
    children: "I am a label",
  },
};

export const BasePlus: Story = {
  args: {
    size: "md",
    weight: "plus",
    children: "I am a label",
  },
};

export const LargeRegular: Story = {
  args: {
    size: "lg",
    weight: "regular",
    children: "I am a label",
  },
};

export const LargePlus: Story = {
  args: {
    size: "lg",
    weight: "plus",
    children: "I am a label",
  },
};

export const SmallRegular: Story = {
  args: {
    size: "sm",
    weight: "regular",
    children: "I am a label",
  },
};

export const SmallPlus: Story = {
  args: {
    size: "sm",
    weight: "plus",
    children: "I am a label",
  },
};

export const XSmallRegular: Story = {
  args: {
    size: "xs",
    weight: "regular",
    children: "I am a label",
  },
};
