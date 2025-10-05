/* eslint-disable unicorn/prefer-object-from-entries */
import type { DeepNonNullable } from 'ts-essentials';

import { isNil, isObject } from 'lodash';

/** Deeply omit null and undefined values from an object. */
export const omitNil = <T extends object>(obj: T) => {
  if (Array.isArray(obj)) {
    return obj.map(omitNil) as unknown as Partial<DeepNonNullable<T>>;
  } else if (isObject(obj)) {
    return Object.entries(obj)
      .filter(([_, v]) => !isNil(v))
      .reduce((acc, [k, v]) => ({ ...acc, [k]: omitNil(v) }), {});
  } else {
    return obj as Partial<DeepNonNullable<T>>;
  }
};
