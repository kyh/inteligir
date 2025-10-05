import { Input } from '@/registry/ui/input';

import { signIn } from './sign-in';

export function DevForm() {
  return (
    <form
      action={async (formData) => {
        'use server';

        await signIn(formData);
      }}
    >
      <label htmlFor="username">Username</label>
      <Input id="username" name="username" />
      <br />
      <label htmlFor="password">Password</label>
      <Input id="password" name="password" type="password" />
      <br />
      <button>Continue</button>
    </form>
  );
}
