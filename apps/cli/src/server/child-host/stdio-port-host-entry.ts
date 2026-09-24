// runs a node module (an ACP adapter) in a utility process main forked for the server, with the
// module's stdin, stdout and stderr carried over the MessagePort main hands this process. argv:
// the module's path.

import { pathToFileURL } from "node:url";
import { attachedPort, readParentPort } from "./message-port";
import { stdioOverPort } from "./stdio-frames";

const parentPort = readParentPort();
const [modulePath] = process.argv.slice(2);
if (parentPort === null || modulePath === undefined) {
  process.stderr.write("stdio-port-host: run it as a utility process, with a module path\n");
  process.exit(2);
}

const stdio = stdioOverPort(await attachedPort(parentPort));
// before the import, so the module and the console it first writes through bind to the port.
for (const name of ["stdin", "stdout", "stderr"] as const) {
  Object.defineProperty(process, name, {
    configurable: true,
    enumerable: true,
    value: stdio[name],
  });
}
process.argv = [process.execPath, modulePath];
await import(pathToFileURL(modulePath).href);
