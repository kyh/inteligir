import { NextApiRequest, NextApiResponse } from "next";
import nc, { ErrorHandler } from "next-connect";
import { AppRequest, AppResponse } from "@server/config";
import {
  sessionMiddleware,
  configurePassport,
} from "@libs/auth/server/authMiddlewares";
import {
  serializeUserId,
  deserializeUser,
} from "@libs/users/server/userService";

export const onError: ErrorHandler<NextApiRequest, NextApiResponse> = (
  err,
  req,
  res,
  next
) => {
  console.error(err);
  res.status(500).end(err.toString());
};

export const createApiHandler = () =>
  nc<NextApiRequest, NextApiResponse>({
    onError,
  });

export const passport = configurePassport(serializeUserId, deserializeUser);

export const createAuthApiHandler = () =>
  nc<AppRequest, AppResponse>({
    onError,
  })
    .use(sessionMiddleware())
    .use(passport.initialize())
    .use(passport.session());
