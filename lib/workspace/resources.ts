import { SELECTABLE_SECTORS, sectorByKey, type Sector, type SectorKey } from "@/lib/regulation";

/** Picks the sector to show: the one asked for in the link, else the reader's own first sector, else the first in the list. */
export function pickSector(requested: string | undefined, own: SectorKey[]): Sector {
  const wanted = requested ? sectorByKey(requested) : undefined;
  if (wanted && wanted.key !== "all") return wanted;
  const mine = own.map((k) => sectorByKey(k)).find((s): s is Sector => Boolean(s));
  return mine ?? SELECTABLE_SECTORS[0]!;
}
