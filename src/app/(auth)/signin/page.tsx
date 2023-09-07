"use client";

import Logo from "~/components/ui/Logo";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useSupabase } from "~/components/providers/supabase-provider";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useState } from "react";

export default function SignInPage() {
  const { supabase } = useSupabase();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");

  const handleSignInWithEmail = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      if (!email) {
        return;
      }

      setIsLoading(true);

      const { data, error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${location.origin}/callback`,
        },
      });

      if (error) {
        console.error(error);
        return;
      }

      setIsLoading(false);

      router.push("/check");
    },
    [email, router, supabase]
  );

  const updateEmail = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value.toLowerCase());
  };

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center space-y-4 px-4">
        <Logo className="" variant="logo" />
        <h1 className="text-3xl font-semibold">Log in or sign up</h1>
        <p className="text-lg text-gray-500">Welcome to Demorepo</p>
        <form
          className="flex w-full flex-col space-y-4"
          onSubmit={handleSignInWithEmail}
        >
          <div className="flex flex-col">
            <label className="mb-2 font-medium" htmlFor="email">
              Email
            </label>
            <Input
              className=""
              type="email"
              name="email"
              placeholder="Enter your email"
              value={email}
              onChange={updateEmail}
            />
          </div>
          <Button className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Email sign in link
          </Button>
        </form>
      </div>
    </div>
  );
}
