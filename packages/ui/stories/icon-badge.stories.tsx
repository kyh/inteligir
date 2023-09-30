import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";

import { Building2Icon } from "../icons";
import { IconBadge } from "../components/icon-badge";

const meta: Meta<typeof IconBadge> = {
  title: "Components/IconBadge",
  component: IconBadge,
  parameters: {
    layout: "centered",
  },
};

export default meta;

type Story = StoryObj<typeof IconBadge>;

export const GreyBase: Story = {
  args: {
    children: <Building2Icon />,
    color: "grey",
    size: "md",
  },
};

export const GreyLarge: Story = {
  args: {
    children: <Building2Icon />,
    color: "grey",
    size: "lg",
  },
};

export const BlueBase: Story = {
  args: {
    children: <Building2Icon />,
    color: "blue",

    size: "md",
  },
};

export const BlueLarge: Story = {
  args: {
    children: <Building2Icon />,
    color: "blue",
    size: "lg",
  },
};

export const GreenBase: Story = {
  args: {
    children: <Building2Icon />,
    color: "green",
    size: "md",
  },
};

export const GreenLarge: Story = {
  args: {
    children: <Building2Icon />,
    color: "green",
    size: "lg",
  },
};

export const RedBase: Story = {
  args: {
    children: <Building2Icon />,
    color: "red",
    size: "md",
  },
};

export const RedLarge: Story = {
  args: {
    children: <Building2Icon />,
    color: "red",
    size: "lg",
  },
};

export const OrangeBase: Story = {
  args: {
    children: <Building2Icon />,
    color: "orange",
    size: "md",
  },
};

export const OrangeLarge: Story = {
  args: {
    children: <Building2Icon />,
    color: "orange",
    size: "lg",
  },
};

export const PurpleBase: Story = {
  args: {
    children: <Building2Icon />,
    color: "purple",
    size: "md",
  },
};

export const PurpleLarge: Story = {
  args: {
    children: <Building2Icon />,
    color: "purple",
    size: "lg",
  },
};
