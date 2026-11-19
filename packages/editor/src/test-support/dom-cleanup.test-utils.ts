import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

configure({ asyncUtilTimeout: 5000 });
