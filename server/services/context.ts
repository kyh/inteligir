import { PrismaClient } from "@prisma/client";
import { parseRequest, getUser } from "services/authentication";

export const prisma = new PrismaClient();

export interface Context {
  prisma: PrismaClient;
  request: any;
  response: any;
  user: any;
}

export function createContext({ req, res }: any) {
  const token = parseRequest(req);
  return {
    prisma,
    request: req,
    response: res,
    user: getUser(token),
  };
}
