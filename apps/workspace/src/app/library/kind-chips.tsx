// One kind at a time over the grid, offered only when the scope holds two or more. The counts are
// the scope's with the chip ignored, so the row never shrinks to the one chip that is pressed.

import type { ItemKind } from "@repo/contract/items/item-kind";
import { isItemKind } from "@repo/contract/items/item-kind";
import { ToggleChip, ToggleGroup } from "@repo/ui/components/toggle-group";

import { CHIP_ORDER, KIND_CHIP_LABELS } from "./item-labels";

const presentKinds = (
  counts: Readonly<Partial<Record<ItemKind, number>>> | undefined,
): ItemKind[] => CHIP_ORDER.filter((kind) => (counts?.[kind] ?? 0) > 0);

export interface KindChipsProps {
  counts: Readonly<Partial<Record<ItemKind, number>>> | undefined;
  kind: ItemKind | null;
  onKindChange: (kind: ItemKind | null) => void;
}

export const KindChips = ({ counts, kind, onKindChange }: KindChipsProps) => {
  const kinds = presentKinds(counts);
  // a pressed chip stays offered even once its kind has emptied, so it can be let go
  const offered = kind !== null && !kinds.includes(kind) ? [...kinds, kind] : kinds;
  if (offered.length < 2) {
    return null;
  }
  return (
    <div className="flex shrink-0 items-center gap-1 px-4 pt-3">
      <ToggleGroup<string>
        aria-label="Kind"
        value={kind === null ? [] : [kind]}
        onValueChange={([picked]) => {
          onKindChange(picked !== undefined && isItemKind(picked) ? picked : null);
        }}
      >
        {offered.map((option) => (
          <ToggleChip key={option} value={option}>
            {KIND_CHIP_LABELS[option]}
            <span className="text-caption opacity-70 tabular-nums">{counts?.[option] ?? 0}</span>
          </ToggleChip>
        ))}
      </ToggleGroup>
    </div>
  );
};
