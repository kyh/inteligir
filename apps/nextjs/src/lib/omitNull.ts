import { isNil, isObject } from 'lodash';
import type { DeepNonNullable } from 'ts-essentials';

/** Deeply omit null and undefined values from an object. */
export const omitNil = <T extends object>(obj: T) => {
  if (Array.isArray(obj)) {
    return obj.map(omitNil) as unknown as Partial<DeepNonNullable<T>>;
  }
  if (isObject(obj)) {
    return Object.entries(obj)
      .filter(([_, v]) => !isNil(v))
      .reduce(
        (acc, [k, v]) => {
          acc[k] = omitNil(v);
          return acc;
        },
        {} as Record<string, unknown>
      );
  }
  return obj as Partial<DeepNonNullable<T>>;
};
