"use client";

import * as React from "react";
import { createRoot } from "react-dom/client";
import type Dialog, { DialogProps } from "./dialog";

type PromptProps = Omit<DialogProps, "onConfirm" | "onCancel" | "open">;

const usePrompt = () => {
  const dialog = async (props: PromptProps): Promise<boolean> => {
    return new Promise((resolve) => {
      let open = true;

      const onCancel = () => {
        open = false;
        render();
        resolve(false);
      };

      const onConfirm = () => {
        open = false;
        resolve(true);
        render();
      };

      const mountRoot = createRoot(document.createElement("div"));

      const render = () => {
        mountRoot.render(
          <Dialog
            onCancel={onCancel}
            onConfirm={onConfirm}
            open={open}
            {...props}
          />,
        );
      };

      render();
    });
  };

  return dialog;
};

export { usePrompt };
