import { NextApiRequest, NextApiResponse } from "next";
import nc, { ErrorHandler } from "next-connect";
import { authMiddleware } from "@server/middlewares";
import { AppNextApiRequest } from "@server/config";

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

export const createAuthApiHandler = () =>
  nc<AppNextApiRequest, NextApiResponse>({
    onError,
  }).use(authMiddleware);
