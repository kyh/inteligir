import type { Metadata } from "next";
import { headers } from "next/headers";
import { Toaster } from "@inteligir/ui";

import { ThemeProvider, TRPCReactProvider } from "./providers";

import "./globals.css";

/**
 * Since we're passing `headers()` to the `TRPCReactProvider` we need to
 * make the entire app dynamic. You can move the `TRPCReactProvider` further
 * down the tree (e.g. /dashboard and onwards) to make part of the app statically rendered.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Inteligir",
  description: "",
  openGraph: {
    title: "Inteligir",
    description: "",
    url: "https://inteligir.com",
    siteName: "Inteligir",
  },
  twitter: {
    card: "summary_large_image",
    site: "@kaiyuhsu",
    creator: "@kaiyuhsu",
  },
};

const Layout = (props: { children: React.ReactNode }) => (
  <html lang="en">
    <body className="bg-ui-bg-base">
      <ThemeProvider>
        <TRPCReactProvider headers={headers()}>
          {props.children}
        </TRPCReactProvider>
      </ThemeProvider>
      <Toaster />
    </body>
  </html>
);

export default Layout;
