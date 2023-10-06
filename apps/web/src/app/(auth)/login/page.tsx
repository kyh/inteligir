"use client";

import { Logo } from "ui/components/logo";
import { Label } from "ui/components/label";
import { Button } from "ui/components/button";
import { Input } from "ui/components/input";
import { useSupabase } from "@/components/supabase-provider";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "ui/components/card";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "ui/components/toaster";
import Link from "next/link";

type FormInput = {
  email: string;
};

export default function LoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput>();
  const { supabase } = useSupabase();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleSignInWithEmail: SubmitHandler<FormInput> = async (inputs) => {
    setIsLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: inputs.email,
      options: {
        emailRedirectTo: `${location.origin}/callback`,
      },
    });

    setIsLoading(false);

    if (error) {
      console.error(error);
      toast.error(error.message);
    } else {
      router.push("/check");
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="mx-auto flex w-full max-w-sm -translate-y-10 flex-col items-center gap-8 px-4">
        <Link href="/">
          <Logo />
        </Link>
        <Card className="w-full bg-ui-bg-base">
          <CardHeader>
            <CardTitle className="text-center">Welcome back</CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <Button className="w-full" variant="outline" size="lg">
                <img src="social/google.webp" width={16} height={16} />
                <span>Continue with Google</span>
              </Button>
            </div>
            <div className="my-5 text-center text-xs text-ui-fg-subtle">
              Or continue with email
            </div>
            <form
              className="flex w-full flex-col gap-4"
              onSubmit={handleSubmit(handleSignInWithEmail)}
            >
              <div className="flex flex-col">
                <Label className="mb-2" htmlFor="email">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  aria-invalid={!!errors.email}
                  {...register("email", {
                    required: true,
                    pattern: {
                      value: /\S+@\S+\.\S+/,
                      message: "Entered value does not match email format",
                    },
                  })}
                />
              </div>
              <Button
                variant="secondary"
                className="w-full"
                isLoading={isLoading}
              >
                Email sign in link
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
