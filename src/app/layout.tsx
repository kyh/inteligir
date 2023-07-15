import "./globals.css";
import { siteConfig } from "~/config/site";

export const metadata = {
  title: siteConfig.site.name,
  description: siteConfig.site.description,
  openGraph: {
    url: siteConfig.site.siteUrl,
    siteName: siteConfig.site.siteName,
    description: siteConfig.site.description,
  },
  themeColor: siteConfig.site.themeColor,
  twitter: {
    card: "summary_large_image",
    title: siteConfig.site.name,
    description: siteConfig.site.description,
    creator: siteConfig.site.twitterHandle,
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

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en" className="dark">
      <body className="bg-black bg-gradient-to-br from-zinc-900 to-black text-base text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
};

export default RootLayout;
