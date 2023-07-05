"use client";

import { Toaster as BaseToast } from "sonner";

export const Toaster: typeof BaseToast = (props) => {
  return <BaseToast theme="dark" {...props} />;
};
