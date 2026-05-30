import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  BuiltinWidgetDef,
  ShellSnapshot,
  WidgetDef,
  WidgetGeometry,
  WidgetInstance,
  WidgetSurface,
} from "@/shared/shell";

type ActionShell = {
  getDef: (widgetId: string) => WidgetDef | null;
  snapshot: () => ShellSnapshot;
  placeWidget: (widgetId: string, surface?: WidgetSurface) => WidgetInstance | null;
  unplaceWidget: (instanceId: string) => boolean;
  deleteWidget: (widgetId: string, expectedRevision?: number) => boolean;
};

const helpers = vi.hoisted(() => {
  const shell = {
    getDef: vi.fn<ActionShell["getDef"]>(),
    snapshot: vi.fn<ActionShell["snapshot"]>(),
    placeWidget: vi.fn<ActionShell["placeWidget"]>(),
    unplaceWidget: vi.fn<ActionShell["unplaceWidget"]>(),
    deleteWidget: vi.fn<ActionShell["deleteWidget"]>(),
  };
  return {
    shell,
    getWritableShell: vi.fn<() => ActionShell | null>(),
    flushRendererInstance: vi.fn<(instanceId: string) => Promise<boolean>>(),
  };
});

vi.mock("@/main/shell", () => ({
  getWritableShell: helpers.getWritableShell,
}));

vi.mock("@/main/lib/widget-flush", () => ({
  flushRendererInstance: helpers.flushRendererInstance,
}));

const { deleteWithFlush, placeWithFlush, unplaceWithFlush } =
  await import("@/main/lib/shell-actions");

const geometry: WidgetGeometry = { x: 0, y: 0, w: 1, h: 1 };

const singletonDef: BuiltinWidgetDef = {
  id: "tasks",
  title: "Tasks",
  revision: 1,
  singleton: true,
  permanent: false,
  defaultGeometry: geometry,
  source: { kind: "builtin-react" },
};

const instance: WidgetInstance = {
  instanceId: "inst-1",
  widgetId: singletonDef.id,
  placement: { surface: "pinned", geometry },
  state: { draft: "unsaved" },
};

describe("shell actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.getWritableShell.mockReturnValue(helpers.shell);
    helpers.shell.getDef.mockReturnValue(singletonDef);
    helpers.shell.snapshot.mockReturnValue({ defs: [singletonDef], instances: [instance] });
    helpers.shell.placeWidget.mockReturnValue(instance);
    helpers.shell.unplaceWidget.mockReturnValue(true);
    helpers.shell.deleteWidget.mockReturnValue(true);
    helpers.flushRendererInstance.mockResolvedValue(true);
  });

  it("does not unplace when the renderer flush fails", async () => {
    helpers.flushRendererInstance.mockResolvedValue(false);

    await expect(unplaceWithFlush(instance.instanceId)).resolves.toBe(false);

    expect(helpers.shell.unplaceWidget).not.toHaveBeenCalled();
  });

  it("does not place a live singleton when its current instance fails to flush", async () => {
    helpers.flushRendererInstance.mockResolvedValue(false);

    await expect(placeWithFlush(singletonDef.id, "floating")).resolves.toBeNull();

    expect(helpers.shell.placeWidget).not.toHaveBeenCalled();
  });

  it("does not delete when any live instance fails to flush", async () => {
    helpers.flushRendererInstance.mockResolvedValue(false);

    await expect(deleteWithFlush(singletonDef.id, 1)).resolves.toBe(false);

    expect(helpers.shell.deleteWidget).not.toHaveBeenCalled();
  });

  it("continues when every required flush succeeds", async () => {
    await expect(unplaceWithFlush(instance.instanceId)).resolves.toBe(true);

    expect(helpers.shell.unplaceWidget).toHaveBeenCalledWith(instance.instanceId);
  });
});
