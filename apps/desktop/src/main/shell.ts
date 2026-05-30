// Persistence for the OS-like workspace ("shell") at ~/.inteligir/shell.json.
// Owns the generated (custom) widget definitions and every placed instance.
// Built-in widget definitions live in code (BUILTIN_WIDGETS); the manager only
// validates instance.widgetId against them. Spec validation is loose — the
// renderer catalog does the strict prop-shape check at mount.

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { broadcastToRenderer } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import {
  builtinMeta,
  CHAT_WIDGET_ID,
  geometryEquals,
  rectEquals,
  slugifyWidgetId,
  WIDGET_DEFAULT_RECT,
  WIDGET_DEFAULT_SIZE,
  type CustomWidgetDef,
  type FloatRect,
  type GenerateWidgetInput,
  type Placement,
  type Shell,
  type ShellSnapshot,
  type WidgetGeometry,
  type WidgetInstance,
  type WidgetPatchInput,
  type WidgetSpec,
  type WidgetSurface,
} from "@/shared/shell";
import { IPC_CHANNELS } from "@/shared/ipc";
import { applyJsonPatchOp } from "@/shared/json-pointer";

const ElementSchema = z.looseObject({
  type: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).optional(),
});

export const WidgetSpecSchema = z.object({
  root: z.string(),
  elements: z.record(z.string(), ElementSchema),
  state: z.record(z.string(), z.unknown()).optional(),
});

export const GeometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
});

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const PinnedPlacementSchema = z.object({
  surface: z.literal("pinned"),
  geometry: GeometrySchema,
});

const FloatingPlacementSchema = z.object({
  surface: z.literal("floating"),
  rect: RectSchema,
  z: z.number(),
});

const PlacementSchema = z.discriminatedUnion("surface", [
  PinnedPlacementSchema,
  FloatingPlacementSchema,
]);

const CustomWidgetDefSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  spec: WidgetSpecSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

const WidgetInstanceSchema = z.object({
  instanceId: z.string(),
  widgetId: z.string(),
  placement: PlacementSchema,
  state: z.record(z.string(), z.unknown()),
});

const ShellSchema = z.object({
  version: z.literal(1),
  customWidgets: z.array(CustomWidgetDefSchema),
  instances: z.array(WidgetInstanceSchema),
});

export const GenerateWidgetInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  spec: WidgetSpecSchema,
  state: z.record(z.string(), z.unknown()).optional(),
});

function chatInstance(): WidgetInstance {
  return {
    instanceId: CHAT_WIDGET_ID,
    widgetId: CHAT_WIDGET_ID,
    placement: { surface: "pinned", geometry: { ...builtinMeta(CHAT_WIDGET_ID)!.defaultGeometry } },
    state: {},
  };
}

const DEFAULTS: Shell = { version: 1, customWidgets: [], instances: [chatInstance()] };

/** Ensure the permanent chat instance exists. Guards a hand-edited file. */
function withChat(shell: Shell): Shell {
  if (shell.instances.some((i) => i.widgetId === CHAT_WIDGET_ID)) return shell;
  return { ...shell, instances: [chatInstance(), ...shell.instances] };
}

export class ShellManager {
  private readonly store: JsonStore<Shell>;

  constructor(storePath?: string) {
    this.store = new JsonStore(
      storePath ?? inteligirPath("shell.json"),
      ShellSchema as unknown as z.ZodType<Shell>,
      DEFAULTS,
    );
  }

  snapshot(): ShellSnapshot {
    const shell = withChat(this.store.read());
    return { customWidgets: [...shell.customWidgets], instances: [...shell.instances] };
  }

  getCustomDef(id: string): CustomWidgetDef | null {
    return this.store.read().customWidgets.find((d) => d.id === id) ?? null;
  }

  getInstance(instanceId: string): WidgetInstance | null {
    return this.store.read().instances.find((i) => i.instanceId === instanceId) ?? null;
  }

  /** Create a custom widget definition and place one pinned instance of it. */
  generateWidget(input: GenerateWidgetInput): { def: CustomWidgetDef; instance: WidgetInstance } {
    const now = Date.now();
    let result: { def: CustomWidgetDef; instance: WidgetInstance } | null = null;
    const next = this.store.update((current) => {
      const id = input.id ?? this.allocateDefId(current, input.title);
      const def: CustomWidgetDef = {
        id,
        title: input.title,
        description: input.description,
        spec: input.spec,
        createdAt: now,
        updatedAt: now,
      };
      const instance = this.makeInstance(current, id, "pinned", input.state ?? input.spec.state ?? {});
      result = { def, instance };
      const customWidgets = current.customWidgets.some((d) => d.id === id)
        ? current.customWidgets.map((d) => (d.id === id ? def : d))
        : [...current.customWidgets, def];
      return { ...current, customWidgets, instances: [...current.instances, instance] };
    });
    this.broadcast(next);
    return result!;
  }

  /** Update a custom widget definition (title/description/spec). */
  updateWidget(input: GenerateWidgetInput & { id: string }): CustomWidgetDef {
    const now = Date.now();
    let result: CustomWidgetDef | null = null;
    const next = this.store.update((current) => {
      const idx = current.customWidgets.findIndex((d) => d.id === input.id);
      if (idx === -1) throw new Error(`No custom widget with id '${input.id}'`);
      const def: CustomWidgetDef = {
        ...current.customWidgets[idx]!,
        title: input.title,
        description: input.description ?? current.customWidgets[idx]!.description,
        spec: input.spec,
        updatedAt: now,
      };
      result = def;
      const customWidgets = [...current.customWidgets];
      customWidgets[idx] = def;
      return { ...current, customWidgets };
    });
    this.broadcast(next);
    return result!;
  }

  /** Apply RFC 6902 ops to a custom widget's spec. Validated before write; an
   * invalid patch throws inside the transform, leaving the store untouched. */
  patchWidgetSpec(input: WidgetPatchInput): CustomWidgetDef {
    const now = Date.now();
    let result: CustomWidgetDef | null = null;
    const next = this.store.update((current) => {
      const idx = current.customWidgets.findIndex((d) => d.id === input.id);
      if (idx === -1) throw new Error(`No custom widget with id '${input.id}'`);
      const draft = structuredClone(current.customWidgets[idx]!.spec);
      for (const op of input.ops) applyJsonPatchOp(draft, op);
      const spec = WidgetSpecSchema.parse(draft) as WidgetSpec;
      const def: CustomWidgetDef = { ...current.customWidgets[idx]!, spec, updatedAt: now };
      result = def;
      const customWidgets = [...current.customWidgets];
      customWidgets[idx] = def;
      return { ...current, customWidgets };
    });
    this.broadcast(next);
    return result!;
  }

  /** Delete a custom widget definition and every instance of it. */
  deleteWidget(widgetId: string): boolean {
    let deleted = false;
    const next = this.store.update((current) => {
      const customWidgets = current.customWidgets.filter((d) => d.id !== widgetId);
      if (customWidgets.length === current.customWidgets.length) return current;
      deleted = true;
      return {
        ...current,
        customWidgets,
        instances: current.instances.filter((i) => i.widgetId !== widgetId),
      };
    });
    if (deleted) this.broadcast(next);
    return deleted;
  }

  /** Place an instance of a widget on the given surface (default: a floating
   * window). Built-in singletons that are already placed return the existing
   * instance. */
  placeWidget(widgetId: string, surface: WidgetSurface = "floating"): WidgetInstance | null {
    const meta = builtinMeta(widgetId);
    let result: WidgetInstance | null = null;
    let added = false;
    const next = this.store.update((current) => {
      if (!meta && !current.customWidgets.some((d) => d.id === widgetId)) return current;
      if (meta?.singleton) {
        const existing = current.instances.find((i) => i.widgetId === widgetId);
        if (existing) {
          result = existing;
          return current;
        }
      }
      const instance = this.makeInstance(current, widgetId, surface, this.initialState(current, widgetId));
      result = instance;
      added = true;
      return { ...current, instances: [...current.instances, instance] };
    });
    if (added) this.broadcast(next);
    return result;
  }

  /** Remove a placed instance. The permanent chat instance can't be removed. */
  unplaceWidget(instanceId: string): boolean {
    let removed = false;
    const next = this.store.update((current) => {
      const target = current.instances.find((i) => i.instanceId === instanceId);
      if (!target || builtinMeta(target.widgetId)?.permanent) return current;
      removed = true;
      return { ...current, instances: current.instances.filter((i) => i.instanceId !== instanceId) };
    });
    if (removed) this.broadcast(next);
    return removed;
  }

  /** Batch-update pinned instances' grid geometry. Ignored for floating ids. */
  setGeometries(geometries: Record<string, WidgetGeometry>): void {
    const current = this.store.read();
    let changed = false;
    const instances = current.instances.map((i) => {
      const geo = geometries[i.instanceId];
      if (!geo || i.placement.surface !== "pinned" || geometryEquals(i.placement.geometry, geo)) {
        return i;
      }
      changed = true;
      return { ...i, placement: { surface: "pinned" as const, geometry: geo } };
    });
    if (!changed) return;
    this.broadcast(this.store.update(() => ({ ...current, instances })));
  }

  /** Move/resize a floating instance. No-op for pinned. */
  setRect(instanceId: string, rect: FloatRect): void {
    this.updateInstance(instanceId, (i) => {
      if (i.placement.surface !== "floating" || rectEquals(i.placement.rect, rect)) return null;
      return { ...i, placement: { ...i.placement, rect } };
    });
  }

  /** Move an instance between the grid and a floating window. Drops to the
   * target surface's defaults — no remembered cross-surface coordinates. */
  setSurface(instanceId: string, surface: WidgetSurface): WidgetInstance | null {
    return this.updateInstance(instanceId, (i, shell) => {
      if (i.placement.surface === surface) return null;
      return { ...i, placement: this.makePlacement(shell, i.widgetId, surface) };
    });
  }

  /** Raise a floating instance above the others. No-op for pinned. */
  bringToFront(instanceId: string): void {
    this.updateInstance(instanceId, (i, shell) => {
      if (i.placement.surface !== "floating") return null;
      const top = this.maxZ(shell);
      if (i.placement.z === top && top > 0) return null;
      return { ...i, placement: { ...i.placement, z: top + 1 } };
    });
  }

  /** Replace an instance's bound state wholesale (single-writer: the viewer
   * owns live state, so a replace lets cleared keys disappear). */
  setInstanceState(instanceId: string, state: Record<string, unknown>): WidgetInstance | null {
    return this.updateInstance(instanceId, (i) => ({ ...i, state }));
  }

  /** Drop the cache + broadcast the post-invalidate read (logout teardown). */
  invalidate(): void {
    this.store.invalidate();
    this.broadcast(this.store.read());
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private makeInstance(
    shell: Shell,
    widgetId: string,
    surface: WidgetSurface,
    state: Record<string, unknown>,
  ): WidgetInstance {
    return {
      instanceId: randomUUID(),
      widgetId,
      placement: this.makePlacement(shell, widgetId, surface),
      state,
    };
  }

  private makePlacement(shell: Shell, widgetId: string, surface: WidgetSurface): Placement {
    if (surface === "pinned") {
      const meta = builtinMeta(widgetId);
      return {
        surface: "pinned",
        geometry: meta ? { ...meta.defaultGeometry } : this.placeNew(shell),
      };
    }
    // Stagger newly-floating windows so they don't all stack at the same spot.
    const floatingCount = shell.instances.filter(
      (i) => i.placement.surface === "floating",
    ).length;
    return {
      surface: "floating",
      rect: {
        ...WIDGET_DEFAULT_RECT,
        x: WIDGET_DEFAULT_RECT.x + (floatingCount % 6) * 28,
        y: WIDGET_DEFAULT_RECT.y + (floatingCount % 6) * 28,
      },
      z: this.maxZ(shell) + 1,
    };
  }

  private initialState(shell: Shell, widgetId: string): Record<string, unknown> {
    const def = shell.customWidgets.find((d) => d.id === widgetId);
    return def?.spec.state ? { ...def.spec.state } : {};
  }

  /** Find one instance by id, apply `mutate`, and broadcast — but only when
   * `mutate` returns a changed instance (null = no-op). Reads first so a no-op
   * (a drag that lands in place, focusing the already-top window) never
   * rewrites the whole shell file. */
  private updateInstance(
    instanceId: string,
    mutate: (instance: WidgetInstance, shell: Shell) => WidgetInstance | null,
  ): WidgetInstance | null {
    const current = this.store.read();
    const idx = current.instances.findIndex((i) => i.instanceId === instanceId);
    if (idx === -1) return null;
    const updated = mutate(current.instances[idx]!, current);
    if (!updated) return null;
    const instances = [...current.instances];
    instances[idx] = updated;
    this.broadcast(this.store.update(() => ({ ...current, instances })));
    return updated;
  }

  private maxZ(shell: Shell): number {
    return shell.instances.reduce(
      (max, i) => (i.placement.surface === "floating" ? Math.max(max, i.placement.z) : max),
      0,
    );
  }

  private placeNew(shell: Shell): WidgetGeometry {
    const nextY = shell.instances.reduce(
      (max, i) =>
        i.placement.surface === "pinned"
          ? Math.max(max, i.placement.geometry.y + i.placement.geometry.h)
          : max,
      0,
    );
    return { x: 5, y: nextY, ...WIDGET_DEFAULT_SIZE };
  }

  private allocateDefId(shell: Shell, title: string): string {
    const base = slugifyWidgetId(title);
    const taken = new Set(shell.customWidgets.map((d) => d.id));
    if (!taken.has(base) && !builtinMeta(base)) return base;
    for (let i = 2; i < 1_000_000; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate) && !builtinMeta(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  private broadcast(shell: Shell): void {
    const safe = withChat(shell);
    broadcastToRenderer(IPC_CHANNELS.SHELL_UPDATED, {
      customWidgets: safe.customWidgets,
      instances: safe.instances,
    } satisfies ShellSnapshot);
  }
}

let _instance: ShellManager | null = null;

export function getShell(): ShellManager {
  if (!_instance) _instance = new ShellManager();
  return _instance;
}

export function resetShellCache(): void {
  _instance?.invalidate();
}
