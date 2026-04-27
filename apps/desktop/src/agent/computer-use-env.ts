// Side-effect-only module — must be imported BEFORE @injaneity/pi-computer-use
// so the package observes our env settings on its very first config read.
//
// ESM evaluates imports depth-first in source order: importing this file before
// the package import guarantees the assignment runs before any pi-computer-use
// code touches process.env, regardless of when the package decides to read it
// (currently lazy, but that's an internal detail we shouldn't depend on).

// Browser windows belong to the CDP-based `browser` tool, not pi-computer-use.
process.env["PI_COMPUTER_USE_BROWSER_USE"] = "0";
