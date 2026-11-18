export type SignInDoor = "sign-in" | "sign-up";

export type SignInField = "name" | "email" | "password" | "inviteCode";

export type SignInForm = Readonly<Record<SignInField, string>>;

const FIELDS: Readonly<Record<SignInDoor, readonly SignInField[]>> = {
  "sign-in": ["email", "password"],
  "sign-up": ["name", "email", "password", "inviteCode"],
};

type ReturnKey = { readonly kind: "next"; readonly field: SignInField } | { readonly kind: "send" };

export const returnOf = (door: SignInDoor, field: SignInField) => {
  const fields = FIELDS[door];
  const next = fields[fields.indexOf(field) + 1];

  return (
    next === undefined ? { kind: "send" } : { field: next, kind: "next" }
  ) satisfies ReturnKey;
};

export const formReady = (door: SignInDoor, form: SignInForm) =>
  FIELDS[door].every((field) => (field === "password" ? form.password : form[field].trim()) !== "");
