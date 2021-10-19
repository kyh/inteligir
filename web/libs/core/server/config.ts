import { NextApiRequest, NextApiResponse } from "next";

export type AppRequest = NextApiRequest &
  Express.Request & {
    session: {
      userId?: string;
      maxAge?: number;
    };
  };

export type AppResponse = NextApiResponse &
  Express.Response & {
    end: (...args: any[]) => Promise<void>;
  };

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
