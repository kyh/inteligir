#!/usr/bin/env node
import { createCliDeps } from "./context";
import { runCli } from "./program";

process.exitCode = await runCli(process.argv, createCliDeps());
