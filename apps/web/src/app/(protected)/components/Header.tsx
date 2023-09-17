import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "ui/components/button";
import { Logo } from "ui/components/logo";

export default function Header({ children }: { children?: React.ReactNode }) {
  const { pathname } = useRouter();

  return (
    <header className="border-b bg-white">
      <nav className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-x-2">
          <Logo />
          {children}
        </div>
        <div className="flex items-center space-x-4">
          {pathname !== "/setup" && (
            <Link href="/setup">
              <Button variant="outline">Setup Demorepo</Button>
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
