import { connection } from "next/server";

import "#styles/globals.css";

export const instant = false;

const AuthLayout = async ({ children }: LayoutProps<"/">) => {
  await connection();

  return await children;
};

export default AuthLayout;
