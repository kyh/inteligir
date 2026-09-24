import { configure } from "@testing-library/react";

// a three-core CI runner running four suites at once misses testing-library's one-second default
// on work a laptop finishes in a tenth of it; the booted suites also cross a real server per wait.
configure({ asyncUtilTimeout: 5000 });
