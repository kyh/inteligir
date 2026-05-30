// Runtime UI kernel persistence at ~/.inteligir/runtime-ui.json.
// Main is the single writer. Renderer surfaces and agent tools submit typed
// commands; this kernel validates specs, placement, and revisions.

import { randomUUID } from "node:crypto";
import { VisibilityConditionSchema } from "@json-render/core";
import { z } from "zod";

import { broadcastToRenderer } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import { IPC_CHANNELS } from "@/shared/ipc";
import { applyJsonPatchOp } from "@/shared/json-pointer";
import {
  BUILTIN_DEFS,
  JSON_WIDGET_COMPONENT_TYPES,
  WIDGET_ACTION_NAMES,
  builtinDef,
  geometryEquals,
  isJsonUi,
  rectEquals,
  slugifyWidgetId,
  WIDGET_DEFAULT_RECT,
  WIDGET_DEFAULT_SIZE,
  type FloatRect,
  type InstallWidgetInput,
  type JsonUiWidgetDef,
  type JsonWidgetComponentType,
  type Placement,
  type Shell,
  type ShellSnapshot,
  type UpdateWidgetInput,
  type WidgetActionName,
  type WidgetActionRequest,
  type WidgetDef,
  type WidgetGeometry,
  type WidgetInstance,
  type WidgetSpecElement,
  type WidgetPatchInput,
  type WidgetSpec,
  type WidgetSurface,
} from "@/shared/shell";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

function stringEnumSchema<T extends string>(values: readonly T[], label: string): z.ZodType<T> {
  return z.custom<T>(
    (value) => typeof value === "string" && values.some((candidate) => candidate === value),
    { message: `Unknown ${label}` },
  );
}

const ComponentTypeSchema: z.ZodType<JsonWidgetComponentType> = stringEnumSchema(
  JSON_WIDGET_COMPONENT_TYPES,
  "widget component type",
);

const ActionNameSchema: z.ZodType<WidgetActionName> = stringEnumSchema(
  WIDGET_ACTION_NAMES,
  "widget action",
);

const ActionRequestSchema: z.ZodType<WidgetActionRequest> = z.object({
  action: ActionNameSchema,
  params: z.record(z.string(), z.unknown()).optional(),
});

const ActionBindingValueSchema = z.union([ActionRequestSchema, z.array(ActionRequestSchema)]);

const ElementSchema: z.ZodType<WidgetSpecElement> = z.object({
  type: ComponentTypeSchema,
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).optional(),
  visible: VisibilityConditionSchema.optional(),
  repeat: z
    .object({
      statePath: z.string(),
      key: z.string().optional(),
    })
    .optional(),
  on: z.record(z.string(), ActionBindingValueSchema).optional(),
  watch: z.record(z.string(), ActionBindingValueSchema).optional(),
});

export const WidgetSpecSchema: z.ZodType<WidgetSpec> = z.object({
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

const JsonUiDefSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  revision: z.number(),
  singleton: z.literal(false),
  permanent: z.literal(false),
  defaultGeometry: GeometrySchema,
  source: z.object({
    kind: z.literal("json-ui"),
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

const ShellSchema: z.ZodType<Shell> = z.object({
  version: z.literal(2),
  customDefs: z.array(JsonUiDefSchema),
  instances: z.array(WidgetInstanceSchema),
  // Default for forward-compat with on-disk shells written before this field
  // existed; new installs start empty.
  archivedStates: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

export const InstallWidgetInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  spec: WidgetSpecSchema,
});

export const UpdateWidgetInputSchema = z.object({
  id: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  spec: WidgetSpecSchema,
});

export const WidgetPatchInputSchema = z.object({
  id: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  ops: z
    .array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("add"), path: z.string(), value: z.unknown() }),
        z.object({ op: z.literal("replace"), path: z.string(), value: z.unknown() }),
        z.object({ op: z.literal("remove"), path: z.string() }),
      ]),
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function seedInstance(def: WidgetDef): WidgetInstance {
  return {
    instanceId: def.id,
    widgetId: def.id,
    placement: { surface: "pinned", geometry: { ...def.defaultGeometry } },
    state: {},
  };
}

const PERMANENT_DEFS = BUILTIN_DEFS.filter((d) => d.permanent);

const DEFAULTS: Shell = {
  version: 2,
  customDefs: [],
  instances: PERMANENT_DEFS.map(seedInstance),
  archivedStates: {},
};

function withPermanents(shell: Shell): Shell {
  const missing = PERMANENT_DEFS.filter((d) => !shell.instances.some((i) => i.widgetId === d.id));
  return missing.length === 0
    ? shell
    : { ...shell, instances: [...missing.map(seedInstance), ...shell.instances] };
}

// ---------------------------------------------------------------------------
// Spec validation
// ---------------------------------------------------------------------------

function validateWidgetSpec(spec: WidgetSpec): void {
  if (!spec.elements[spec.root]) {
    throw new Error(`Widget spec root '${spec.root}' does not exist`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Widget spec has a child cycle at '${id}'`);
    const element = spec.elements[id];
    if (!element) throw new Error(`Widget spec references missing child '${id}'`);
    visiting.add(id);
    for (const child of element.children ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  visit(spec.root);
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export class ShellManager {
  private readonly store: JsonStore<Shell>;

  constructor(storePath?: string) {
    this.store = new JsonStore(
      storePath ?? inteligirPath("runtime-ui.json"),
      ShellSchema,
      DEFAULTS,
    );
    // Repair a hand-edited shell.json that validates but is missing a
    // permanent instance (e.g. someone dropped the chat row). Without this,
    // snapshot()/broadcast() would synthesize the missing instance on the
    // fly while the in-memory store still lacked it — so getInstance, the
    // grid-geometry writer, and setInstanceState would silently no-op for
    // those instanceIds.
    this.store.update(withPermanents);
  }

  snapshot(): ShellSnapshot {
    const shell = withPermanents(this.store.read());
    return {
      defs: [...BUILTIN_DEFS, ...shell.customDefs],
      instances: [...shell.instances],
    };
  }

  getDef(id: string): WidgetDef | null {
    return builtinDef(id) ?? this.store.read().customDefs.find((d) => d.id === id) ?? null;
  }

  getInstance(instanceId: string): WidgetInstance | null {
    return this.store.read().instances.find((i) => i.instanceId === instanceId) ?? null;
  }

  installWidget(input: InstallWidgetInput): JsonUiWidgetDef {
    const now = Date.now();
    const spec = WidgetSpecSchema.parse(input.spec);
    validateWidgetSpec(spec);

    let installed: JsonUiWidgetDef | null = null;
    const next = this.store.update((current) => {
      const id = input.id ?? this.allocateDefId(current, input.title);
      if (this.findDef(current, id)) throw new Error(`Widget '${id}' already exists`);
      const def: JsonUiWidgetDef = {
        id,
        title: input.title,
        description: input.description,
        revision: 1,
        singleton: false,
        permanent: false,
        defaultGeometry: { x: 5, y: 0, ...WIDGET_DEFAULT_SIZE },
        source: {
          kind: "json-ui",
          spec: structuredClone(spec),
          createdAt: now,
          updatedAt: now,
        },
      };
      installed = def;
      return { ...current, customDefs: [...current.customDefs, def] };
    });
    this.broadcast(next);
    if (!installed) throw new Error("Widget install failed");
    return installed;
  }

  updateWidget(input: UpdateWidgetInput): JsonUiWidgetDef {
    const spec = WidgetSpecSchema.parse(input.spec);
    validateWidgetSpec(spec);
    return this.mutateJsonUiDef(input.id, input.expectedRevision, (def) => {
      return {
        ...def,
        title: input.title ?? def.title,
        description: input.description ?? def.description,
        revision: def.revision + 1,
        source: {
          ...def.source,
          spec: structuredClone(spec),
          updatedAt: Date.now(),
        },
      };
    });
  }

  patchWidgetSpec(input: WidgetPatchInput): JsonUiWidgetDef {
    if (input.ops.length === 0) throw new Error("Widget patch must contain at least one op");
    return this.mutateJsonUiDef(input.id, input.expectedRevision, (def) => {
      const draft = structuredClone(def.source.spec);
      for (const op of input.ops) applyJsonPatchOp(draft, op);
      const spec = WidgetSpecSchema.parse(draft);
      validateWidgetSpec(spec);
      return {
        ...def,
        revision: def.revision + 1,
        source: { ...def.source, spec, updatedAt: Date.now() },
      };
    });
  }

  /** Delete a custom widget definition, every instance of it, and any
   * archived state — a same-id widget created later should start clean. */
  deleteWidget(widgetId: string, expectedRevision?: number): boolean {
    let deleted = false;
    const next = this.store.update((current) => {
      const target = current.customDefs.find((d) => d.id === widgetId);
      if (!target) return current;
      if (expectedRevision !== undefined && target.revision !== expectedRevision) {
        throw new Error(
          `Widget '${widgetId}' revision mismatch: expected ${expectedRevision}, got ${target.revision}`,
        );
      }
      deleted = true;
      const { [widgetId]: _discarded, ...archivedStates } = current.archivedStates;
      return {
        ...current,
        customDefs: current.customDefs.filter((d) => d.id !== widgetId),
        instances: current.instances.filter((i) => i.widgetId !== widgetId),
        archivedStates,
      };
    });
    if (deleted) this.broadcast(next);
    return deleted;
  }

  placeWidget(widgetId: string, surface?: WidgetSurface): WidgetInstance | null {
    let result: WidgetInstance | null = null;
    let changed = false;
    const next = this.store.update((current) => {
      const def = this.findDef(current, widgetId);
      if (!def) return current;
      if (def.singleton) {
        const existing = current.instances.find((i) => i.widgetId === widgetId);
        if (existing) {
          const updated = this.placementForExistingSingleton(current, def, existing, surface);
          result = updated ?? existing;
          if (!updated) return current;
          changed = true;
          return {
            ...current,
            instances: current.instances.map((i) =>
              i.instanceId === existing.instanceId ? updated : i,
            ),
          };
        }
      }
      // Rehydrate from the per-widgetId archive only when no instance of this
      // widget is currently placed. The archive bridges an unplace/re-place
      // cycle; it should not seed a new sibling while a live instance exists.
      const liveInstance = current.instances.some((i) => i.widgetId === def.id);
      const archived = liveInstance ? undefined : current.archivedStates[def.id];
      const initial: Record<string, unknown> = archived
        ? { ...archived }
        : isJsonUi(def) && def.source.spec.state
          ? { ...def.source.spec.state }
          : {};
      const instance = this.makeInstance(current, def, surface ?? "floating", initial);
      result = instance;
      changed = true;
      return { ...current, instances: [...current.instances, instance] };
    });
    if (changed) this.broadcast(next);
    return result;
  }

  /** Remove a placed instance. Permanent defs' instances can't be removed.
   * Archives the instance's state by widgetId so a later placeWidget can
   * restore what the user typed (overwriting any earlier archive — multi-
   * instance unplaces collapse to the last-closed state). */
  unplaceWidget(instanceId: string): boolean {
    let removed = false;
    const next = this.store.update((current) => {
      const target = current.instances.find((i) => i.instanceId === instanceId);
      if (!target) return current;
      const def = this.findDef(current, target.widgetId);
      if (def?.permanent) return current;
      removed = true;
      // Always reflect what state was at unplace time: writing it for non-empty
      // state, dropping any stale prior entry when the user cleared everything.
      // Otherwise the next placement would still rehydrate from a stale
      // archive that no longer matches what the user dismissed.
      const archivedStates: Record<string, Record<string, unknown>> = {
        ...current.archivedStates,
      };
      if (Object.keys(target.state).length > 0) {
        archivedStates[target.widgetId] = { ...target.state };
      } else {
        delete archivedStates[target.widgetId];
      }
      return {
        ...current,
        instances: current.instances.filter((i) => i.instanceId !== instanceId),
        archivedStates,
      };
    });
    if (removed) this.broadcast(next);
    return removed;
  }

  setGeometries(geometries: Record<string, WidgetGeometry>): void {
    const current = this.store.read();
    let changed = false;
    const instances = current.instances.map((i) => {
      const geo = geometries[i.instanceId];
      if (!geo || i.placement.surface !== "pinned") return i;
      const merged: WidgetGeometry = {
        x: geo.x,
        y: geo.y,
        w: geo.w,
        h: geo.h,
        minW: geo.minW ?? i.placement.geometry.minW,
        minH: geo.minH ?? i.placement.geometry.minH,
      };
      if (geometryEquals(i.placement.geometry, merged)) {
        return i;
      }
      changed = true;
      const placement: Placement = { surface: "pinned", geometry: merged };
      return { ...i, placement };
    });
    if (!changed) return;
    this.broadcast(this.store.update(() => ({ ...current, instances })));
  }

  setRect(instanceId: string, rect: FloatRect): void {
    this.updateInstance(instanceId, (i) => {
      if (i.placement.surface !== "floating" || rectEquals(i.placement.rect, rect)) return null;
      return { ...i, placement: { ...i.placement, rect } };
    });
  }

  setSurface(instanceId: string, surface: WidgetSurface): WidgetInstance | null {
    return this.updateInstance(instanceId, (i, shell) => {
      if (i.placement.surface === surface) return null;
      const def = this.findDef(shell, i.widgetId);
      return { ...i, placement: this.makePlacement(shell, def, surface) };
    });
  }

  bringToFront(instanceId: string): void {
    this.updateInstance(instanceId, (i, shell) => this.focusedFloatingInstance(shell, i));
  }

  setInstanceState(instanceId: string, state: Record<string, unknown>): WidgetInstance | null {
    return this.updateInstance(instanceId, (i) => ({ ...i, state }));
  }

  invalidate(): void {
    this.store.invalidate();
    this.broadcast(this.store.read());
  }

  private placementForExistingSingleton(
    shell: Shell,
    def: WidgetDef,
    existing: WidgetInstance,
    surface?: WidgetSurface,
  ): WidgetInstance | null {
    if (surface && existing.placement.surface !== surface) {
      return { ...existing, placement: this.makePlacement(shell, def, surface) };
    }
    // No surface override: dock-click intent is "focus this widget." For
    // floating, raise it to the top of z-order. For pinned, there's no z, so
    // pop it out as a floating window — otherwise the click silently no-ops
    // while the dock indicates the widget is active.
    if (existing.placement.surface === "floating") {
      return this.focusedFloatingInstance(shell, existing);
    }
    return { ...existing, placement: this.makePlacement(shell, def, "floating") };
  }

  private focusedFloatingInstance(shell: Shell, instance: WidgetInstance): WidgetInstance | null {
    if (instance.placement.surface !== "floating") return null;
    const top = this.maxZ(shell);
    if (instance.placement.z === top && top > 0) return null;
    return { ...instance, placement: { ...instance.placement, z: top + 1 } };
  }

  private findDef(shell: Shell, widgetId: string): WidgetDef | undefined {
    return builtinDef(widgetId) ?? shell.customDefs.find((d) => d.id === widgetId);
  }

  private mutateJsonUiDef(
    id: string,
    expectedRevision: number,
    mutate: (def: JsonUiWidgetDef) => JsonUiWidgetDef,
  ): JsonUiWidgetDef {
    let result: JsonUiWidgetDef | null = null;
    const next = this.store.update((current) => {
      const idx = current.customDefs.findIndex((d) => d.id === id);
      const target = idx === -1 ? null : current.customDefs[idx];
      if (!target) throw new Error(`No generated widget with id '${id}'`);
      if (target.revision !== expectedRevision) {
        throw new Error(
          `Widget '${id}' revision mismatch: expected ${expectedRevision}, got ${target.revision}`,
        );
      }
      const updated = mutate(target);
      result = updated;
      return {
        ...current,
        customDefs: current.customDefs.map((d) => (d.id === id ? updated : d)),
      };
    });
    this.broadcast(next);
    if (!result) throw new Error(`No generated widget with id '${id}'`);
    return result;
  }

  private updateInstance(
    instanceId: string,
    mutate: (instance: WidgetInstance, shell: Shell) => WidgetInstance | null,
  ): WidgetInstance | null {
    const current = this.store.read();
    const target = current.instances.find((i) => i.instanceId === instanceId);
    if (!target) return null;
    const updated = mutate(target, current);
    if (!updated) return null;
    const instances = current.instances.map((i) => (i.instanceId === instanceId ? updated : i));
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

  private makePlacement(
    shell: Shell,
    def: WidgetDef | undefined,
    surface: WidgetSurface,
  ): Placement {
    if (surface === "pinned") {
      return { surface: "pinned", geometry: { ...(def?.defaultGeometry ?? this.placeNew(shell)) } };
    }
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
    });
  }
}

let instance: ShellManager | null = null;

export function getShell(): ShellManager {
  if (!instance) instance = new ShellManager();
  return instance;
}

export function resetShellCache(): void {
  // Null the singleton so the next getShell() builds a fresh instance — a
  // surviving reference to the old one would keep writing through its warm
  // cache, undoing logout.
  instance?.invalidate();
  instance = null;
}
