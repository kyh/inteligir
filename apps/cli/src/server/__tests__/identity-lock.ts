/** The mutation lock a unit test passes when serialization is not under test:
 *  runs the work immediately. The service REQUIRES a lock so production cannot
 *  forget one (two concurrent guarded writes could both pass the CAS hash
 *  check); a test states the same choice explicitly instead of inheriting a
 *  silent default. */
export const identityLock = <T>(work: () => Promise<T>): Promise<T> => work();
