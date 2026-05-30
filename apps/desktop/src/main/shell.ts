// Persistence for the OS-like workspace ("shell") at ~/.inteligir/shell.json.
// Owns every custom widget definition and every placed instance. Built-in defs
// live in code (BUILTIN_DEFS); the manager only validates instance.widgetId
// against them. Spec validation is loose — the renderer catalog does the
// strict prop-shape check at mount.

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { broadcastToRenderer } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import {
  BUILTIN_DEFS,
  builtinDef,
  geometryEquals,
  rectEquals,
  slugifyWidgetId,
  WIDGET_DEFAULT_RECT,
  WIDGET_DEFAULT_SIZE,
  type CreateWidgetInput,
  type FloatRect,
  type Placement,
  type Shell,
  type ShellSnapshot,
  type WidgetDef,
  type WidgetGeometry,
  type WidgetInstance,
  type WidgetPatchInput,
  type WidgetSpec,
  type WidgetSurface,
} from "@/shared/shell";
import { IPC_CHANNELS } from "@/shared/ipc";
import { applyJsonPatchOp } from "@/shared/json-pointer";

// ---------------------------------------------------------------------------
// Schemas — what we persist (custom defs + instances)
// ---------------------------------------------------------------------------

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

// Persisted custom def — source.kind is always "custom" on disk.
const CustomDefSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  singleton: z.boolean(),
  permanent: z.boolean(),
  defaultGeometry: GeometrySchema,
  source: z.object({
    kind: z.literal("custom"),
    spec: WidgetSpecSchema,
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
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

const WidgetInstanceSchema = z.object({
  instanceId: z.string(),
  widgetId: z.string(),
  placement: PlacementSchema,
  state: z.record(z.string(), z.unknown()),
});

const ShellSchema = z.object({
  version: z.literal(1),
  customDefs: z.array(CustomDefSchema),
  instances: z.array(WidgetInstanceSchema),
});

export const CreateWidgetInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  spec: WidgetSpecSchema,
  state: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Seed — every permanent built-in starts with one instance.
// ---------------------------------------------------------------------------

function seedInstance(def: WidgetDef): WidgetInstance {
  return {
    // Permanent defs (chat) get a stable id so a re-broadcast lines up; the
    // singleton constraint means there's no collision risk.
    instanceId: def.id,
    widgetId: def.id,
    placement: { surface: "pinned", geometry: { ...def.defaultGeometry } },
    state: {},
  };
}

const PERMANENT_DEFS = BUILTIN_DEFS.filter((d) => d.permanent);

const DEFAULTS: Shell = {
  version: 1,
  customDefs: [],
  instances: PERMANENT_DEFS.map(seedInstance),
};

/** Ensure every permanent def has a placed instance. Guards a hand-edited
 * file from dropping a system surface. */
function withPermanents(shell: Shell): Shell {
  const missing = PERMANENT_DEFS.filter(
    (d) => !shell.instances.some((i) => i.widgetId === d.id),
  );
  return missing.length === 0
    ? shell
    : { ...shell, instances: [...missing.map(seedInstance), ...shell.instances] };
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

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
    const shell = withPermanents(this.store.read());
    return {
      defs: [...BUILTIN_DEFS, ...shell.customDefs],
      instances: [...shell.instances],
    };
  }

  /** Look up any def by id — built-in or custom. */
  getDef(id: string): WidgetDef | null {
    return builtinDef(id) ?? this.store.read().customDefs.find((d) => d.id === id) ?? null;
  }

  getInstance(instanceId: string): WidgetInstance | null {
    return this.store.read().instances.find((i) => i.instanceId === instanceId) ?? null;
  }

  /** Create a custom widget definition (and place one pinned instance of it). */
  createWidget(input: CreateWidgetInput): { def: WidgetDef; instance: WidgetInstance } {
    const now = Date.now();
    let result: { def: WidgetDef; instance: WidgetInstance } | null = null;
    const next = this.store.update((current) => {
      const id = input.id ?? this.allocateDefId(current, input.title);
      const def: WidgetDef = {
        id,
        title: input.title,
        description: input.description,
        singleton: false,
        permanent: false,
        defaultGeometry: { x: 5, y: 0, ...WIDGET_DEFAULT_SIZE },
        source: { kind: "custom", spec: input.spec, createdAt: now, updatedAt: now },
      };
      const instance = this.makeInstance(current, def, "pinned", input.state ?? input.spec.state ?? {});
      result = { def, instance };
      const customDefs = current.customDefs.some((d) => d.id === id)
        ? current.customDefs.map((d) => (d.id === id ? def : d))
        : [...current.customDefs, def];
      return { ...current, customDefs, instances: [...current.instances, instance] };
    });
    this.broadcast(next);
    return result!;
  }

  /** Update a custom widget definition (title/description/spec). */
  updateWidget(input: CreateWidgetInput & { id: string }): WidgetDef {
    const now = Date.now();
    return this.mutateCustomDef(input.id, (def) => {
      if (def.source.kind !== "custom") {
        throw new Error(`Widget '${input.id}' is built-in and can't be updated`);
      }
      return {
        ...def,
        title: input.title,
        description: input.description ?? def.description,
        source: { kind: "custom", spec: input.spec, createdAt: def.source.createdAt, updatedAt: now },
      };
    });
  }

  /** Apply RFC 6902 ops to a custom widget's spec. Validated before write; an
   * invalid patch throws inside the transform, leaving the store untouched. */
  patchWidgetSpec(input: WidgetPatchInput): WidgetDef {
    const now = Date.now();
    return this.mutateCustomDef(input.id, (def) => {
      if (def.source.kind !== "custom") {
        throw new Error(`Widget '${input.id}' is built-in and can't be patched`);
      }
      const draft = structuredClone(def.source.spec);
      for (const op of input.ops) applyJsonPatchOp(draft, op);
      const spec = WidgetSpecSchema.parse(draft) as WidgetSpec;
      return { ...def, source: { ...def.source, spec, updatedAt: now } };
    });
  }

  /** Delete a custom widget definition and every instance of it. */
  deleteWidget(widgetId: string): boolean {
    let deleted = false;
    const next = this.store.update((current) => {
      const customDefs = current.customDefs.filter((d) => d.id !== widgetId);
      if (customDefs.length === current.customDefs.length) return current;
      deleted = true;
      return {
        ...current,
        customDefs,
        instances: current.instances.filter((i) => i.widgetId !== widgetId),
      };
    });
    if (deleted) this.broadcast(next);
    return deleted;
  }

  /** Place an instance of a widget on the given surface (default: a floating
   * window). Singleton defs that are already placed return the existing
   * instance. Unknown widget ids return null. */
  placeWidget(widgetId: string, surface: WidgetSurface = "floating"): WidgetInstance | null {
    let result: WidgetInstance | null = null;
    let added = false;
    const next = this.store.update((current) => {
      const def = this.findDef(current, widgetId);
      if (!def) return current;
      if (def.singleton) {
        const existing = current.instances.find((i) => i.widgetId === widgetId);
        if (existing) {
          result = existing;
          return current;
        }
      }
      const initial =
        def.source.kind === "custom" && def.source.spec.state ? { ...def.source.spec.state } : {};
      const instance = this.makeInstance(current, def, surface, initial);
      result = instance;
      added = true;
      return { ...current, instances: [...current.instances, instance] };
    });
    if (added) this.broadcast(next);
    return result;
  }

  /** Remove a placed instance. Permanent defs' instances can't be removed. */
  unplaceWidget(instanceId: string): boolean {
    let removed = false;
    const next = this.store.update((current) => {
      const target = current.instances.find((i) => i.instanceId === instanceId);
      if (!target) return current;
      const def = this.findDef(current, target.widgetId);
      if (def?.permanent) return current;
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
      const def = this.findDef(shell, i.widgetId);
      return { ...i, placement: this.makePlacement(shell, def, surface) };
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

  /** Resolve a widget id against the in-flight shell + the code registry. */
  private findDef(shell: Shell, widgetId: string): WidgetDef | undefined {
    return builtinDef(widgetId) ?? shell.customDefs.find((d) => d.id === widgetId);
  }

  /** Find one custom def by id, apply `mutate`, broadcast. Throws on unknown. */
  private mutateCustomDef(id: string, mutate: (def: WidgetDef) => WidgetDef): WidgetDef {
    let result: WidgetDef | null = null;
    const next = this.store.update((current) => {
      const idx = current.customDefs.findIndex((d) => d.id === id);
      if (idx === -1) throw new Error(`No custom widget with id '${id}'`);
      const updated = mutate(current.customDefs[idx]!);
      result = updated;
      const customDefs = [...current.customDefs];
      customDefs[idx] = updated;
      return { ...current, customDefs };
    });
    this.broadcast(next);
    return result!;
  }

  /** Find one instance by id, apply `mutate`, broadcast — but only when
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

  private makeInstance(
    shell: Shell,
    def: WidgetDef,
    surface: WidgetSurface,
    state: Record<string, unknown>,
  ): WidgetInstance {
    return {
      instanceId: randomUUID(),
      widgetId: def.id,
      placement: this.makePlacement(shell, def, surface),
      state,
    };
  }

  private makePlacement(shell: Shell, def: WidgetDef | undefined, surface: WidgetSurface): Placement {
    if (surface === "pinned") {
      return { surface: "pinned", geometry: { ...(def?.defaultGeometry ?? this.placeNew(shell)) } };
    }
    // Stagger newly-floating windows so they don't all stack at the same spot.
    const floatingCount = shell.instances.filter((i) => i.placement.surface === "floating").length;
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
    const taken = new Set(shell.customDefs.map((d) => d.id));
    if (!taken.has(base) && !builtinDef(base)) return base;
    for (let i = 2; i < 1_000_000; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate) && !builtinDef(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  private broadcast(shell: Shell): void {
    const safe = withPermanents(shell);
    broadcastToRenderer(IPC_CHANNELS.SHELL_UPDATED, {
      defs: [...BUILTIN_DEFS, ...safe.customDefs],
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
