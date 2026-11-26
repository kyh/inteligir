import { getSignUpAuth } from "./auth";

/** A fresh sign-in code for `email`, minted without mail: for the seed, the suites and `pnpm sign-in-code`. */
export const mintSignInCode = async (email: string) =>
  await getSignUpAuth().api.createVerificationOTP({ body: { email, type: "sign-in" } });
