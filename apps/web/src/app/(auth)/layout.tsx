import type { Metadata } from "next";
import { connection } from "next/server";

import "#styles/globals.css";

// the account pages are forms for people already invited, never a search result
export const metadata: Metadata = { robots: { follow: false, index: false } };

// Each page carries proxy.ts's nonce, which a prerendered shell is written without, so the whole
// document renders per request and nothing may suspend above this call.
export const instant = false;

const AuthLayout = async ({ children }: LayoutProps<"/">): Promise<React.ReactNode> => {
  await connection();
  return await children;
};

export default AuthLayout;
