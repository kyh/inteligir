import { createFileRoute } from "@tanstack/react-router";

import { WorkspacePage } from "@renderer/workspace/workspace-page";

export const Route = createFileRoute("/")({ component: WorkspacePage });
