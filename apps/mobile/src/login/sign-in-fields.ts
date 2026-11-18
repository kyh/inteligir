// The sign-in form's fields as Return moves through them: each field's Return goes to the next, and
// the last one's sends the form once every field is filled, so nobody reaches past the keyboard
// for the button.

export type SignInDoor = "sign-in" | "sign-up";

export type SignInField = "name" | "email" | "password" | "inviteCode";

export type SignInForm = Readonly<Record<SignInField, string>>;

const FIELDS: Readonly<Record<SignInDoor, readonly SignInField[]>> = {
  "sign-in": ["email", "password"],
  "sign-up": ["name", "email", "password", "inviteCode"],
};

export type ReturnKey =
  | { readonly kind: "next"; readonly field: SignInField }
  | { readonly kind: "send" };

export const returnOf = (door: SignInDoor, field: SignInField): ReturnKey => {
  const fields = FIELDS[door];
  const next = fields[fields.indexOf(field) + 1];
  return next === undefined ? { kind: "send" } : { field: next, kind: "next" };
};

// every field of the door filled, a password as typed and the rest past their spaces
export const formReady = (door: SignInDoor, form: SignInForm): boolean =>
  FIELDS[door].every((field) => (field === "password" ? form.password : form[field].trim()) !== "");
