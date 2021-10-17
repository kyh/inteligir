import { NextApiRequest } from "next";

export interface AppNextApiRequest extends NextApiRequest {
  session?: {
    userId?: string;
  };
}

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
