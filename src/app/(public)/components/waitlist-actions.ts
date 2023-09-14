"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const register = async (formData: FormData) => {
  console.log("Registering...", formData);
  await sleep(5000);
  const email = formData.get("email")?.toString();

  if (!email) throw new Error("Email is required");

  cookies().set("registered_waitlist", email);
  revalidatePath("/");
};
