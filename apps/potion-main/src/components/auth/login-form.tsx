'use client';

import type { Route } from 'next';

import { usePathname, useSearchParams } from 'next/navigation';
import { useQueryState } from 'nuqs';

import { Icons } from '@/components/ui/icons';
import { encodeURL } from '@/lib/url/encodeURL';
import { cn } from '@/lib/utils';
import { Button } from '@/registry/ui/button';
import { signIn } from '@/server/auth/auth-client';

const authRoutes: Route[] = ['/login'];

export function LoginForm() {
  let [callbackUrl] = useQueryState('callbackUrl');
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!callbackUrl && !authRoutes.includes(pathname as Route)) {
    callbackUrl = encodeURL(pathname, searchParams.toString());
  }

  const handleGithubSignIn = () => {
    signIn.social({
      callbackURL: callbackUrl ? decodeURIComponent(callbackUrl) : '/',
      provider: 'github',
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
