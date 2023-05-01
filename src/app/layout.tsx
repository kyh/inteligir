import "./globals.css";

import { cookies } from "next/headers";

import initializeServerI18n from "~/i18n/i18n.server";
import { I18N_COOKIE_NAME } from "~/i18n/i18n.settings";

import configuration from "~/configuration";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const i18n = await initializeServerI18n(getLanguageCookie());

  return (
    <html lang={i18n.language} className="dark">
      <body>{children}</body>
    </html>
  );
}

function getLanguageCookie() {
  return cookies().get(I18N_COOKIE_NAME)?.value;
}

export const metadata = {
  title: configuration.site.name,
  description: configuration.site.description,
  openGraph: {
    url: configuration.site.siteUrl,
    siteName: configuration.site.siteName,
    description: configuration.site.description,
  },
  themeColor: configuration.site.themeColor,
  twitter: {
    card: "summary_large_image",
    title: configuration.site.name,
    description: configuration.site.description,
    creator: configuration.site.twitterHandle,
  },
  icons: {
    icon: "/assets/images/favicon/favicon.ico",
    shortcut: "/shortcut-icon.png",
    apple: "/assets/images/favicon/apple-touch-icon.png",
    other: {
      rel: "apple-touch-icon-precomposed",
      url: "/apple-touch-icon-precomposed.png",
    },
  },
};
