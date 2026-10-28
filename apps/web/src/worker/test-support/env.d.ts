// extends Cloudflare.Env (what `env` is typed as) with the bindings only the suites declare
import type { LibraryDO } from "../library/library-do";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_SCHEMA: string;
      // ctx.exports.LibraryDO's namespace under a binding name, since listDurableObjectIds finds a
      // namespace by the name env binds it to; the Worker itself never reads it
      LIBRARY_CELL: DurableObjectNamespace<LibraryDO>;
    }
  }
}
