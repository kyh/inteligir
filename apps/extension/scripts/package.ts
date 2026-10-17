// `pnpm package:extension`: builds --mode store into .output/store, zips it to
// .output/inteligir-extension-<version>.zip and writes .output/unpacked, refusing a store manifest
// that carries a key or host permissions.

// PIVOT-STUB(X): builds, zips and checks the store output (§8.6)
process.stderr.write("the extension's store package is not written yet\n");
process.exitCode = 1;
