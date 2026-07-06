# Building with inteligir UI (@repo/ui)

A **Tailwind CSS v4** design system. You style with Tailwind utility classes; the
design tokens are CSS variables surfaced as semantic color/spacing/radius utilities.
Font is **Inter** (`font-sans`, the variable InterVariable face — weight axis 100–900 + optical size), applied by default.

## Setup & wrapping

Most components render correctly with **no provider** (context hooks have safe
defaults). Wrap only when you use these:

- **Tooltip** → wrap the tooltip(s) in `<TooltipProvider>`.
- **Sidebar** → wrap the whole sidebar + its trigger in `<SidebarProvider>` (required — subparts call `useSidebar()`).
- **Toasts** → mount **one** `<Toaster />` at the app root, then call `toast("Saved")` / `toast.success(...)` / `toast.error(...)` imperatively.
- **Confirm dialogs** → mount **one** `<ConfirmDialogHost />` at the app root, then `await confirm({ title, body })` (returns `Promise<boolean>`).
- **Corner style** (optional): `<ShapeProvider defaultShape="pill" | "rounded">` toggles every component's corner radius globally. Default is `pill`.
- **Dark mode**: add the class **`dark`** to an ancestor (e.g. `<html class="dark">`). Optional `<ThemeProvider>` owns OS-preference resolution and toggles that class for you.

## Styling idiom — token-backed Tailwind utilities

Style layout and surfaces with these **real** utility families (backed by CSS-variable tokens; they adapt to light/dark automatically). Prefer these over raw hex:

| Purpose | Utilities |
|---|---|
| Base surface / text | `bg-background` `text-foreground` |
| Cards / popovers | `bg-card` `bg-popover` `text-card-foreground` |
| Emphasis | `bg-primary text-primary-foreground` · `bg-secondary` · `bg-accent` · `bg-muted text-muted-foreground` |
| Danger | `bg-destructive text-destructive-foreground` |
| Borders / focus | `border-border` `ring-ring` |
| Elevation ladder | `bg-surface-1` … `bg-surface-8` + `shadow-surface-1` … `shadow-surface-8` (higher = more raised) |
| Interactive states | `bg-hover` `bg-active` (surface-relative overlays) |
| Radius | `rounded-lg` `rounded-xl` `rounded-2xl` … (scaled from `--radius`) |
| Type | `font-sans` (Inter); vary weight with `font-medium` / `font-semibold` |

All standard Tailwind utilities (`flex`, `grid`, `gap-*`, `p-*`, `text-*`) are available for your own layout glue.

## Document / prose type scale

For document, note, and doc-page content, use this **compact scale** (the app's editor and the Fluid Functionalism doc pages share it). Sizes are explicit `text-[…px]`, headings are `font-semibold tracking-tight`, body is regular weight. Base text is small (13px) — this is a dense, information-forward scale, not a marketing scale.

| Role | Class | Size / treatment |
|---|---|---|
| Page title | `text-[28px] font-semibold tracking-tight leading-[1.2]` | 28px |
| Heading 1 | `text-[22px] font-semibold tracking-tight leading-[1.3]` | 22px |
| Heading 2 | `text-[16px] font-semibold tracking-tight leading-[1.3]` | 16px |
| Heading 3 | `text-[15px] font-semibold tracking-tight leading-[1.3]` | 15px |
| Body | `text-[13px] leading-relaxed` | 13px |
| Caption / meta | `text-[12px] text-muted-foreground` | 12px |

Headings use `text-foreground`; secondary/body copy often uses `text-muted-foreground`. Keep heading→body contrast via weight + color, not just size (H2 16px is only 3px over body).

## Compound components

Compose from subparts imported from the same library, e.g. `Dialog` + `DialogTrigger` + `DialogContent` + `DialogHeader` + `DialogTitle` + `DialogDescription` + `DialogFooter` + `DialogClose`; likewise `DropdownMenu`/`DropdownTrigger`/`DropdownContent`/`MenuItem`, `Popover*`, `Tabs`/`TabsList`/`TabItem`/`TabPanel`, `Breadcrumb*`, `Collapsible*`, `Command*`, `Sidebar*`. **Overlay triggers use the `render` prop, not children**: `<DialogTrigger render={<Button>Open</Button>} />`. Open state is controlled by `open`/`defaultOpen` on the root.

## Where the truth lives

Read `styles.css` (and its `@import`ed `_ds_bundle.css`) for the full token + utility set before styling. Each component ships `<Name>.d.ts` (the exact prop contract) and `<Name>.prompt.md` (usage). `Tabs.TabItem` takes `label` (not children); `Switch` needs `label`+`checked`+`onToggle`; `Badge` has a 17-value `color` plus `variant` (`solid`/`dot`).

## Idiomatic snippet

```tsx
<div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4 shadow-surface-2">
  <div className="flex items-center justify-between">
    <span className="font-semibold text-foreground">Q3 Planning</span>
    <Badge color="green" variant="dot">Active</Badge>
  </div>
  <p className="text-sm text-muted-foreground">3 tasks delegated to the agent.</p>
  <div className="flex gap-2">
    <Button variant="primary" leadingIcon={Plus}>New task</Button>
    <Button variant="ghost">Open note</Button>
  </div>
</div>
```
