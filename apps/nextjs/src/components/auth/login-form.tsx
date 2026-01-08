"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useQueryState } from "nuqs";

import { authClient } from "@/auth/auth-client";
import { Icons } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/registry/ui/button";

const authRoutes = ["/login", "/auth/login"];

function encodeURL(pathname: string, search: string): string {
  const url = search ? `${pathname}?${search}` : pathname;
  return encodeURIComponent(url);
}

export function LoginForm() {
  const [callbackUrl] = useQueryState("callbackUrl");
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const computedCallbackUrl =
    callbackUrl ??
    (!authRoutes.includes(pathname)
      ? encodeURL(pathname, searchParams.toString())
      : null);

  const handleGithubSignIn = () => {
    authClient.signIn.social({
      callbackURL: computedCallbackUrl
        ? decodeURIComponent(computedCallbackUrl)
        : "/",
      provider: "github",
    });
  };

  return (
    <div className={cn('mx-auto grid space-y-6 py-4')}>
      <div className="flex flex-col gap-2 text-center">
        <Icons.logo className="mx-auto mb-3 size-8 text-foreground" />
        <div className="font-semibold text-xl">Welcome back</div>
        <p className="text-muted-foreground">Sign in or create an account</p>
      </div>

      <Button
        className="mx-auto h-9 px-4"
        icon={<Icons.github className="size-6" />}
        onClick={handleGithubSignIn}
      >
        Continue with GitHub
      </Button>
    </div>
  );
}
