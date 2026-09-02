// Slice D2 — shared category metadata for the Client Master Data screen
// (PRODUCT_UX_BLUEPRINT.md §5 row 5 / §14's `/organisations/[id]/
// master-data/[category]` route). One route handles all seven
// master-data entity types (six SCD2-versioned, plus Business Unit)
// rather than seven near-identical route trees — "the smallest coherent
// experience" (instructions §9), not seven copies of the same screen.
export const MASTER_DATA_CATEGORIES = [
  "business-units",
  "data-principal-categories",
  "personal-data-elements",
  "purposes",
  "systems",
  "data-stores",
  "processors",
] as const;

export type MasterDataCategory = (typeof MASTER_DATA_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<MasterDataCategory, string> = {
  "business-units": "Business Units",
  "data-principal-categories": "Data Principal Categories",
  "personal-data-elements": "Personal Data Elements",
  purposes: "Purposes",
  systems: "Systems",
  "data-stores": "Data Stores",
  processors: "Processors",
};

export function isMasterDataCategory(value: string): value is MasterDataCategory {
  return (MASTER_DATA_CATEGORIES as readonly string[]).includes(value);
}
