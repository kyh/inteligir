import type { Metadata } from "next";
import { Suspense } from "react";

import { skipWhenSignedIn } from "#lib/auth-server";
import { authPageSearchSchema } from "#lib/next-path";

import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

const SignUpEntry = async ({ searchParams }: Pick<PageProps<"/app/sign-up">, "searchParams">) => {
  const { next } = authPageSearchSchema.parse(await searchParams);
  await skipWhenSignedIn(next);

  return <SignUpForm next={next} />;
};

const SignUpPage = ({ searchParams }: PageProps<"/app/sign-up">) => (
  <Suspense fallback={null}>
    <SignUpEntry searchParams={searchParams} />
  </Suspense>
);

export default SignUpPage;
