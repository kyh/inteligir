import { configure } from "@testing-library/react";

// a booted suite's every wait crosses a real server in the same process: a CI runner with three
// cores misses testing-library's one-second default where a laptop never does.
configure({ asyncUtilTimeout: 5000 });
