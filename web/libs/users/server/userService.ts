import { hash } from "bcrypt";
import { prisma } from "@server/prisma";

const saltRounds = 10;

const defaultSelect = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  image: true,
  role: true,
  updatedAt: true,
  createdAt: true,
};

export const createUser = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}) => {
  const passwordHash = await hash(password, saltRounds);

  return prisma.user.create({
    data: { email, passwordHash },
    select: defaultSelect,
  });
};

export const getUsers = async () => {
  return prisma.user.findMany({ select: defaultSelect });
};

export const getUser = async (email: string) => {
  return prisma.user.findUnique({
    where: { email },
    select: defaultSelect,
  });
};

export const getUserPasswordHash = async (email: string) => {
  const user = await prisma.user.findUnique({
    where: { email },
  });
  const passwordHash = user.passwordHash;
  delete user.passwordHash;
  return { user, passwordHash };
};

export const getUserById = async (id: string) => {
  return prisma.user.findUnique({
    where: { id },
    select: defaultSelect,
  });
};
