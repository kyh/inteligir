import type { Metadata } from "next";
import { Suspense } from "react";

import { authPageSearchSchema } from "#lib/next-path";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

// the way back is the request's, so the form streams in behind the boundary
const ForgotPasswordEntry = async ({
  searchParams,
}: Pick<PageProps<"/app/forgot-password">, "searchParams">) => {
  const { next } = authPageSearchSchema.parse(await searchParams);
  return <ForgotPasswordForm next={next} />;
};

const ForgotPasswordPage = ({ searchParams }: PageProps<"/app/forgot-password">) => (
  <Suspense fallback={null}>
    <ForgotPasswordEntry searchParams={searchParams} />
  </Suspense>
);

export default ForgotPasswordPage;
