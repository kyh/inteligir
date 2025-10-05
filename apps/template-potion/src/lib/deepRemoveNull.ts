import type { DeepNonNullable } from 'ts-essentials';

import { isNil } from 'lodash';

export function deepRemoveNull<T>(obj: T): DeepNonNullable<T> {
  return Object.fromEntries(
    Object.entries(obj as any)
      .filter(([_, v]) => !isNil(v))
      .map(([k, v]) => [k, v === Object(v) ? deepRemoveNull(v) : v])
  ) as DeepNonNullable<T>;
}
