import "./globals.css";
import configuration from "~/configuration";

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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black-700 bg-gradient-to-br from-gray-900 to-black-700 text-base text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
