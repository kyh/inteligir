import { NextApiRequest } from "next";
import { Session } from "next-auth";

export interface AppNextApiRequest extends NextApiRequest {
  session?: Session & {
    userId?: string;
  };
}

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
