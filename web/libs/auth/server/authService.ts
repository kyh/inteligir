import { User } from "@prisma/client";
import { sign } from "jsonwebtoken";
import { hash, compare } from "bcrypt";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_SECRET,
  cookieOptions,
} from "./authConfig";

const SALT_ROUNDS = 10;

export const createPasswordHash = async (password: string) => {
  const passwordHash = await hash(password, SALT_ROUNDS);
  return passwordHash;
};

export const validatePassword = async (
  passwordHash: string,
  password: string
) => {
  const isMatchingPassword = await compare(password, passwordHash);
  return isMatchingPassword;
};

export const createTokens = (user: Partial<User>) => {
  const accessToken = sign({ user }, ACCESS_TOKEN_SECRET, {
    expiresIn: "7d",
  });

  return { accessToken };
};

export const handleTokenRequest = (user: Partial<User>, res: any) => {
  const { accessToken } = createTokens(user);
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, cookieOptions);
};

export const handleTokenDestroy = (res: any) => {
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, "", cookieOptions);
};
