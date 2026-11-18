import type { Metadata } from "next";
import { Suspense } from "react";

import { skipWhenSignedIn } from "#lib/auth-server";
import { authPageSearchSchema } from "#lib/next-path";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const SignInEntry = async ({ searchParams }: Pick<PageProps<"/app/sign-in">, "searchParams">) => {
  const { next } = authPageSearchSchema.parse(await searchParams);
  await skipWhenSignedIn(next);

  return <SignInForm next={next} />;
};

const SignInPage = ({ searchParams }: PageProps<"/app/sign-in">) => (
  <Suspense fallback={null}>
    <SignInEntry searchParams={searchParams} />
  </Suspense>
);

export default SignInPage;
