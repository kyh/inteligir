import type { Metadata } from "next";
import { connection } from "next/server";

import "#styles/globals.css";

export const metadata: Metadata = { robots: { follow: false, index: false } };

export const instant = false;

const AuthLayout = async ({ children }: LayoutProps<"/">) => {
  await connection();

  return await children;
};

export default AuthLayout;
