import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";

import { Container } from "../components/container";

const meta: Meta<typeof Container> = {
  title: "Components/Container",
  component: Container,
};

export default meta;

type Story = StoryObj<typeof Container>;

export const Default: Story = {
  args: {
    children: <p>Hello World</p>,
  },
  parameters: {
    layout: "centered",
  },
};

export const InLayout: Story = {
  render: () => (
    <div className="flex h-screen w-screen">
      <div className="w-full max-w-[216px] border-r border-ui-border-base p-4">
        <h1 className="text-lg">Menubar</h1>
      </div>
      <div className="flex w-full flex-col gap-y-2 px-8 pb-8 pt-6">
        <Container>
          <h1>Section 1</h1>
        </Container>
        <Container>
          <h1>Section 2</h1>
        </Container>
        <Container>
          <h1>Section 3</h1>
        </Container>
      </div>
    </div>
  ),
  parameters: {
    layout: "fullscreen",
  },
};
