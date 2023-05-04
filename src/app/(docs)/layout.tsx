import { Layout } from "./components/Layout";

interface DocsLayoutProps {
  children: React.ReactNode;
}

export default function DocsLayout({ children }: DocsLayoutProps) {
  return <Layout>{children}</Layout>;
}
