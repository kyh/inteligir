import { User } from "@prisma/client";
import { sign } from "jsonwebtoken";
import { hash, compare } from "bcrypt";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_SECRET,
  cookieOptions,
} from "./config";

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

  const refreshToken = sign({ user }, REFRESH_TOKEN_SECRET, {
    expiresIn: "90d",
  });

  return { accessToken, refreshToken };
};

export const handleTokenRequest = async (user: Partial<User>, res: any) => {
  const { accessToken, refreshToken } = await createTokens(user);
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, cookieOptions);
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, cookieOptions);
};
