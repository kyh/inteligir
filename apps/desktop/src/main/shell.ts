// Runtime UI kernel persistence at ~/.inteligir/runtime-ui.json.
// Main is the single writer. Renderer surfaces and agent tools submit typed
// commands; this kernel validates specs, placement, and revisions.

import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";

import { broadcast } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import { DEFAULT_SHELL, defaultShellSnapshot, shellSnapshot } from "@/main/shell-defaults";
import { migrateShellV2ToV3, ShellSchema } from "@/main/shell-schema";
import { applyJsonPatchOp } from "@/shared/json-pointer";
import { parseWidgetSpec } from "@/shared/widget-spec";
import {
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
  type Placement,
  type Shell,
  type ShellSnapshot,
  type UpdateWidgetInput,
  type WidgetDef,
  type WidgetGeometry,
  type WidgetInstance,
  type WidgetPatchInput,
  type WidgetSurface,
} from "@/shared/shell";

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export class ShellManager {
  private readonly store: JsonStore<Shell>;

  constructor(storePath?: string) {
    const file = storePath ?? inteligirPath("runtime-ui.json");
    this.store = new JsonStore<Shell>(file, ShellSchema, DEFAULT_SHELL, {
      // On-disk WidgetSpec is Type.Unknown() in ShellSchema — narrow each
      // custom def's spec via parseWidgetSpec on read so callers see the
      // tightened WidgetSpec type. A spec that fails the structural validation
      // throws and triggers JsonStore's corrupt-recovery path. Per-component
      // prop validation is deliberately skipped on this read path: it runs at
      // the write boundary (install/update/patch), and a legacy def written
      // before that gate must not nuke the whole store — the renderer's
      // validateWidgetProps still flags it, and the next update/patch fixes it.
      decode: (raw) => {
        // Re-check against the concrete schema purely to narrow the type —
        // JsonStore already validated, but its TSchema-typed read can't prove
        // it to the compiler. Runs once per process; cost is negligible.
        if (!Value.Check(ShellSchema, raw)) {
          throw new Error("shell decode received a non-conforming value");
        }
        const v = raw;
        const customDefs: JsonUiWidgetDef[] = [];
        for (const d of v.customDefs) {
          customDefs.push({
            ...d,
            source: {
              ...d.source,
              spec: parseWidgetSpec(d.source.spec, { skipComponentProps: true }),
            },
          });
        }
        return { ...v, customDefs };
      },
      versioning: {
        current: 3,
        // runtime-ui.json was introduced at `version: 2` (v1 lived at the
        // now-retired shell.json path), so an unversioned file was never a
        // legitimate state — treat it as corruption: backed up + surfaced,
        // not silently wiped.
        fromLegacy: () => {
          throw new Error("runtime-ui.json was never written without a version field");
        },
        migrations: {
          // v2 → v3: executor 1.4 → 1.5 moved tool addressing to
          // connection-scoped paths; rewrite every widget spec's callTool
          // addresses so pre-existing dashboard panels (Up Next, People, …)
          // resume loading data once the user reconnects.
          2: migrateShellV2ToV3,
        },
      },
      // Hot path: widget state ticks, drags, and geometry changes each
      // rewrite the whole file (which can embed entire API responses pulled
      // into widget state). Coalesce instead of a synchronous write per
      // mutation; setInstanceState awaits flush() to keep the renderer flush
      // protocol's persisted=true honest.
      coalesceWrites: true,
    });
  }

  snapshot(): ShellSnapshot {
    return shellSnapshot(this.store.read());
  }

  getDef(id: string): WidgetDef | null {
    return builtinDef(id) ?? this.store.read().customDefs.find((d) => d.id === id) ?? null;
  }

  getInstance(instanceId: string): WidgetInstance | null {
    return this.store.read().instances.find((i) => i.instanceId === instanceId) ?? null;
  }

  installWidget(input: InstallWidgetInput): JsonUiWidgetDef {
    const now = Date.now();
    const spec = parseWidgetSpec(input.spec);

    let installed: JsonUiWidgetDef | null = null;
    const next = this.store.update((current) => {
      const id = input.id ?? this.allocateDefId(current, input.title);
      if (this.findDef(current, id)) throw new Error(`Widget '${id}' already exists`);
      const def: JsonUiWidgetDef = {
        id,
        title: input.title,
        ...(input.description === undefined ? {} : { description: input.description }),
        revision: 1,
        singleton: false,
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
    const spec = parseWidgetSpec(input.spec);
    return this.mutateJsonUiDef(input.id, input.expectedRevision, (def) => {
      return {
        ...def,
        title: input.title ?? def.title,
        // ...def already carries the existing description; only override when
        // the caller supplied one (optional props stay absent, not undefined).
        ...(input.description === undefined ? {} : { description: input.description }),
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
      const spec = parseWidgetSpec(draft);
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
      // Deep-clone the seed so live state actions that mutate nested
      // collections (push to an array, splice an object) don't bleed back
      // into the persisted def template or the archive entry.
      const initial: Record<string, unknown> = archived
        ? structuredClone(archived)
        : isJsonUi(def) && def.source.spec.state
          ? structuredClone(def.source.spec.state)
          : {};
      const instance = this.makeInstance(current, def, surface ?? "floating", initial);
      result = instance;
      changed = true;
      return { ...current, instances: [...current.instances, instance] };
    });
    if (changed) this.broadcast(next);
    return result;
  }

  /** Remove a placed instance. Archives the instance's state by widgetId so a
   * later placeWidget can restore what the user typed (overwriting any earlier
   * archive — multi-instance unplaces collapse to the last-closed state). */
  unplaceWidget(instanceId: string): boolean {
    let removed = false;
    const next = this.store.update((current) => {
      const target = current.instances.find((i) => i.instanceId === instanceId);
      if (!target) return current;
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
      const minW = geo.minW ?? i.placement.geometry.minW;
      const minH = geo.minH ?? i.placement.geometry.minH;
      const merged: WidgetGeometry = {
        x: geo.x,
        y: geo.y,
        w: geo.w,
        h: geo.h,
        ...(minW === undefined ? {} : { minW }),
        ...(minH === undefined ? {} : { minH }),
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

  /**
   * Replace an instance's bound state and resolve only once the change is
   * durably on disk. The renderer's flushPersist reports persisted=true when
   * the IPC behind this resolves — with coalesced store writes, awaiting the
   * store flush is what keeps that guarantee honest. Rejects if the disk
   * write failed, so the flush bridge acks persisted=false instead of letting
   * an unplace/delete proceed on state that never landed.
   */
  async setInstanceState(
    instanceId: string,
    state: Record<string, unknown>,
  ): Promise<WidgetInstance | null> {
    const updated = this.updateInstance(instanceId, (i) => ({ ...i, state }));
    if (updated) await this.store.flush();
    return updated;
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
    // An explicit surface request: switch if different, otherwise leave the
    // placement alone. Falling through to the "no surface" focus path would
    // pop a pinned singleton to floating even when the caller asked for
    // pinned.
    if (surface) {
      if (existing.placement.surface !== surface) {
        return { ...existing, placement: this.makePlacement(shell, def, surface) };
      }
      return null;
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
    // Only a no-op when this instance is uniquely at the top. With a tie at
    // z=top, none is actually drawn above the others, so a focus click must
    // raise this one above its peers.
    if (instance.placement.z === top && top > 0) {
      let countAtTop = 0;
      for (const i of shell.instances) {
        if (i.placement.surface === "floating" && i.placement.z === top) countAtTop++;
      }
      if (countAtTop === 1) return null;
    }
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
    broadcast("onShellUpdated", shellSnapshot(shell));
  }

  /**
   * Await any pending coalesced store write. setInstanceState already flushes
   * itself; this is for lifecycle hooks (e.g. a before-quit handler) that
   * want the latest drag/geometry/install writes on disk before the process
   * exits.
   */
  flushStore(): Promise<void> {
    return this.store.flush();
  }

  /**
   * Disable writes on the underlying store. Called by resetShellCache before
   * the AGENT_DIR rm so a stale reference held elsewhere cannot resurrect
   * the file between the cache reset and the recursive delete.
   */
  closeStore(): void {
    this.store.close();
  }
}

let instance: ShellManager | null = null;
// Suspended between logout and the next login. While true, write IPCs and
// shell-actions wrappers no-op — a debounced setInstanceState landing after
// teardownResources would otherwise construct a fresh ShellManager that
// re-creates ~/.inteligir and seeds runtime-ui.json with the in-flight edit,
// undoing the logout wipe.
let writesSuspended = false;

function getShell(): ShellManager {
  if (!instance) instance = new ShellManager();
  return instance;
}

export function getShellSnapshot(): ShellSnapshot {
  return writesSuspended ? defaultShellSnapshot() : getShell().snapshot();
}

export function getWritableShell(): ShellManager | null {
  return writesSuspended ? null : getShell();
}

export function resetShellCache(): void {
  // Close the underlying JsonStore before nulling the singleton — any handler
  // holding the old `instance` reference would otherwise still be able to
  // call store.update(), which mkdirSyncs the dir and writes the file,
  // undoing the AGENT_DIR rm later in teardownResources.
  if (instance) instance.closeStore();
  // Null the singleton so the next getShell() builds a fresh instance — a
  // surviving reference to the old one would keep writing through its warm
  // cache, undoing logout. We intentionally do NOT call invalidate() here:
  // its broadcast would re-publish the still-on-disk snapshot (the rm hasn't
  // run yet) and let the renderer briefly re-show the prior session's
  // widgets before our defaults broadcast lands.
  writesSuspended = true;
  instance = null;
  // Push the default snapshot to any renderer subscribers so they drop the
  // prior session's defs/instances. Without this, the renderer's Zustand
  // store keeps stale data (initShell's `initialized` guard prevents a
  // re-fetch) and re-login renders against it.
  broadcast("onShellUpdated", defaultShellSnapshot());
}

/** Re-enable writes after a successful login. Called from the auth flow
 * once ~/.inteligir is back in a usable state. */
export function resumeShellWrites(): void {
  writesSuspended = false;
}
