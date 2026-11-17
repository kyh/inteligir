import type { Metadata } from "next";

// the account pages are forms for people already invited, never a search result
export const metadata: Metadata = { robots: { follow: false, index: false } };

const AuthLayout = ({ children }: LayoutProps<"/">): React.ReactNode => children;

export default AuthLayout;
