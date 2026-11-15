// Nothing turns on vitest's `globals`, so Testing Library never registers its own auto-cleanup and
// a rendered tree stays mounted past its case.

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
