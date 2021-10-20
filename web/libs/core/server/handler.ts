import { NextApiRequest, NextApiResponse } from "next";
import { error } from "next/dist/build/output/log";
import nc from "next-connect";
import { configurePassport } from "@libs/auth/server/middlewares/passport";
import { sessionMiddleware } from "@libs/auth/server/middlewares/session";
import { trustProxyMiddleware } from "@libs/auth/server/middlewares/trustProxy";
import { serializeUser, deserializeUser } from "@libs/users/server/userService";

export type AppRequest = NextApiRequest & Express.Request;

export type AppResponse = NextApiResponse & Express.Response;

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

export const passport = configurePassport(serializeUser, deserializeUser);

export const createHandler = () =>
  nc<AppRequest, AppResponse>({
    onError: (err, _, res) => {
      error(err);
      res.status(500).end(err.toString());
    },
  })
    .use(process.env.VERCEL ? trustProxyMiddleware : (_, __, next) => next())
    .use(sessionMiddleware)
    .use(passport.initialize())
    .use(passport.session());
