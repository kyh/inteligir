// Nothing turns on vitest's `globals`, so Testing Library never registers its own auto-cleanup and
// a rendered tree stays mounted past its case. slate-react arms its selectionchange handler on a
// lodash throttle, whose timer is a plain node timer that jsdom's teardown cannot clear; only
// unmounting cancels it. Left mounted, it fires into an environment whose DOM globals are already
// gone — an unhandled `ShadowRoot is not defined` that fails the run while every test still passes.

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
