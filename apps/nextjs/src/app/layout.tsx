import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

import { cache } from "react";
import { headers } from "next/headers";
import { Toaster } from "@inteligir/ui";

import { ThemeProvider } from "@/components/theme-provider";
import { TRPCReactProvider } from "@/lib/trpc/react";

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

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

// Lazy load headers
const getHeaders = cache(async () => {
  return headers();
});

const Layout = (props: { children: React.ReactNode }) => (
  <html lang="en">
    <body className={["font-sans", fontSans.variable].join(" ")}>
      <ThemeProvider>
        <TRPCReactProvider headersPromise={getHeaders()}>
          {props.children}
        </TRPCReactProvider>
      </ThemeProvider>
      <Toaster />
    </body>
  </html>
);

export default Layout;
