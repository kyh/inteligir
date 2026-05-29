// Persistence layer for the reshapeable workspace ("shell") at
// ~/.inteligir/shell.json. The shell is a flat list of widgets, each with a
// grid geometry; the chat widget is seeded permanently. Spec validation is
// loose here — the renderer catalog does the strict prop-shape check at mount.

import { z } from "zod";

import { broadcastToRenderer } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import {
  slugifyArtifactId,
  type ArtifactPatchInput,
  type ArtifactSpec,
  type ArtifactUpsertInput,
} from "@/shared/artifacts";
import {
  ARTIFACT_DEFAULT_SIZE,
  CHAT_WIDGET_ID,
  defaultChatWidget,
  geometryEquals,
  type ArtifactWidget,
  type Shell,
  type ShellList,
  type Widget,
  type WidgetGeometry,
} from "@/shared/shell";
import { IPC_CHANNELS } from "@/shared/ipc";
import { applyJsonPatchOp } from "@/shared/json-pointer";

const ElementSchema = z.looseObject({
  type: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).optional(),
});

export const ArtifactSpecSchema = z.object({
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

const ChatWidgetSchema = z.object({
  id: z.literal(CHAT_WIDGET_ID),
  type: z.literal("chat"),
  geometry: GeometrySchema,
});

const ArtifactWidgetSchema = z.object({
  id: z.string(),
  type: z.literal("artifact"),
  title: z.string(),
  description: z.string().optional(),
  spec: ArtifactSpecSchema,
  state: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
  geometry: GeometrySchema,
});

const ShellSchema = z.object({
  version: z.literal(1),
  widgets: z.array(z.discriminatedUnion("type", [ChatWidgetSchema, ArtifactWidgetSchema])),
});

export const ArtifactUpsertInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  spec: ArtifactSpecSchema,
  state: z.record(z.string(), z.unknown()).optional(),
});

const DEFAULTS: Shell = { version: 1, widgets: [defaultChatWidget()] };

/** Ensure exactly one chat widget exists, prepended. Guards a hand-edited or
 * partial file from dropping the permanent surface. */
function withChat(widgets: Widget[]): Widget[] {
  if (widgets.some((w) => w.type === "chat")) return widgets;
  return [defaultChatWidget(), ...widgets];
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

  list(): ShellList {
    return { widgets: withChat([...this.store.read().widgets]) };
  }

  getWidget(id: string): Widget | null {
    return this.store.read().widgets.find((w) => w.id === id) ?? null;
  }

  /** Create or replace an artifact widget. New widgets are auto-placed; an
   * existing widget keeps its geometry + createdAt and just gets new content. */
  upsertArtifact(input: ArtifactUpsertInput): ArtifactWidget {
    const now = Date.now();
    let result: ArtifactWidget | null = null;
    const next = this.store.update((current) => {
      const widgets = withChat([...current.widgets]);
      const id = input.id ?? this.allocateId(widgets, input.title);
      const idx = widgets.findIndex((w) => w.id === id && w.type === "artifact");
      const existing = idx === -1 ? undefined : (widgets[idx] as ArtifactWidget);
      const widget: ArtifactWidget = existing
        ? {
            ...existing,
            title: input.title,
            description: input.description ?? existing.description,
            spec: input.spec,
            state: input.state ?? existing.state,
            updatedAt: now,
          }
        : {
            id,
            type: "artifact",
            title: input.title,
            description: input.description,
            spec: input.spec,
            state: input.state ?? input.spec.state ?? {},
            createdAt: now,
            updatedAt: now,
            geometry: this.placeNew(widgets),
          };
      result = widget;
      const nextWidgets =
        idx === -1 ? [...widgets, widget] : widgets.map((w, i) => (i === idx ? widget : w));
      return { ...current, widgets: nextWidgets };
    });
    this.broadcast(next);
    if (!result) throw new Error("upsertArtifact failed to produce a widget");
    return result;
  }

  /** Apply RFC 6902 ops to an artifact widget's spec (JSON Pointers rooted at
   * the spec). Validated before write; an invalid patch throws inside the
   * transform, so the store is left untouched and no broadcast fires. */
  patchArtifactSpec(input: ArtifactPatchInput): ArtifactWidget {
    const now = Date.now();
    let result: ArtifactWidget | null = null;
    const next = this.store.update((current) => {
      const idx = current.widgets.findIndex((w) => w.id === input.id && w.type === "artifact");
      if (idx === -1) throw new Error(`No artifact widget with id '${input.id}'`);
      const existing = current.widgets[idx] as ArtifactWidget;
      const draft = structuredClone(existing.spec);
      for (const op of input.ops) applyJsonPatchOp(draft, op);
      const validated = ArtifactSpecSchema.parse(draft) as ArtifactSpec;
      const updated: ArtifactWidget = { ...existing, spec: validated, updatedAt: now };
      result = updated;
      const widgets = [...current.widgets];
      widgets[idx] = updated;
      return { ...current, widgets };
    });
    this.broadcast(next);
    return result!;
  }

  /** Replace an artifact widget's bound state wholesale (single-writer: the
   * viewer owns live state, so a replace lets cleared keys disappear). Bumps
   * updatedAt so a remounted viewer reseeds from fresh state. */
  setArtifactState(id: string, state: Record<string, unknown>): ArtifactWidget | null {
    const now = Date.now();
    let result: ArtifactWidget | null = null;
    const next = this.store.update((current) => {
      const idx = current.widgets.findIndex((w) => w.id === id && w.type === "artifact");
      if (idx === -1) return current;
      const updated: ArtifactWidget = {
        ...(current.widgets[idx] as ArtifactWidget),
        state,
        updatedAt: now,
      };
      result = updated;
      const widgets = [...current.widgets];
      widgets[idx] = updated;
      return { ...current, widgets };
    });
    if (result) this.broadcast(next);
    return result;
  }

  /** Move/resize a widget. Geometry is layout, not content — does not bump
   * updatedAt. Accepts a batch so a single drag persists once. */
  setGeometries(geometries: Record<string, WidgetGeometry>): void {
    const current = this.store.read();
    let changed = false;
    const widgets = current.widgets.map((w) => {
      const geo = geometries[w.id];
      if (!geo || geometryEquals(w.geometry, geo)) return w;
      changed = true;
      return { ...w, geometry: geo };
    });
    // Skip the whole-file write entirely when a drag lands where it started
    // (or the mount-time callback fires with unchanged geometry).
    if (!changed) return;
    this.broadcast(this.store.update((s) => ({ ...s, widgets })));
  }

  /** Remove a widget. The permanent chat widget can't be removed. */
  removeWidget(id: string): boolean {
    let removed = false;
    const next = this.store.update((current) => {
      const target = current.widgets.find((w) => w.id === id);
      if (!target || target.type === "chat") return current;
      removed = true;
      return { ...current, widgets: current.widgets.filter((w) => w.id !== id) };
    });
    if (removed) this.broadcast(next);
    return removed;
  }

  /** Drop the cache + broadcast the post-invalidate read (logout teardown). */
  invalidate(): void {
    this.store.invalidate();
    this.broadcast(this.store.read());
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private placeNew(widgets: Widget[]): WidgetGeometry {
    const nextY = widgets.reduce((max, w) => Math.max(max, w.geometry.y + w.geometry.h), 0);
    return { x: 5, y: nextY, ...ARTIFACT_DEFAULT_SIZE };
  }

  private allocateId(widgets: Widget[], title: string): string {
    const base = slugifyArtifactId(title);
    const taken = new Set(widgets.map((w) => w.id));
    if (!taken.has(base) && base !== CHAT_WIDGET_ID) return base;
    for (let i = 2; i < 1_000_000; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  private broadcast(shell: Shell): void {
    broadcastToRenderer(IPC_CHANNELS.SHELL_UPDATED, {
      widgets: withChat(shell.widgets),
    } satisfies ShellList);
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
