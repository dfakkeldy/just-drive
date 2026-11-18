/**
 * Per-area words for the 1884 era: page title, title-card door and credits (period road names: history-road-names.ts).
 * No imports: the title card, the address code and plain-node page tools load it.
 */
export type HistoryAreaId = 'mabou' | 'judique';
export interface HistoryArea {
  readonly id: HistoryAreaId;
  readonly name: string;
  /** Page and title-card heading. */
  readonly title: string;
  /** Short Just Drive address segment, without a slash. */
  readonly address: string;
  readonly description: string;
  /** Title-card credits for this area's 1884 sources, as HTML paragraphs. */
  readonly credits: string;
}
const SHARED = '<p>The roads, buildings and bridges are fictional period approximations. Farm density follows a count of residence symbols on the 1884 county map; house positions are invented. The same modern land survey supplies the terrain.</p>';
const COUNTY = (excluded: string) => `<p>1884 residence counts: A.F. Church and Co., topographical township map of Inverness County, Nova Scotia (1884). Scan: David Rumsey Map Collection, David Rumsey Map Center, Stanford Libraries. Counts are approximate; ${excluded}.</p>`;
export const HISTORY_AREAS: Readonly<Record<HistoryAreaId, HistoryArea>> = Object.freeze({
  mabou: Object.freeze({ id: 'mabou', name: 'Mabou', title: 'Mabou, 1884', address: 'mabou-1884',
    description: 'A fictional journey near Mabou, Cape Breton, based on an 1884 survey sheet.',
    credits: '<p>1884 places: Geological Survey of Canada, Cape Breton sheets 14 and 16 (Hugh Fletcher, 1884); transcribed from scans of the David Rumsey Map Collection.</p>'
      + COUNTY('six uncertain residences are excluded') + SHARED }),
  judique: Object.freeze({ id: 'judique', name: 'Judique', title: 'Judique, 1884', address: 'judique-1884',
    description: 'A fictional journey near Judique, Cape Breton, based on an 1884 survey sheet.',
    credits: '<p>1884 places and road names: Geological Survey of Canada, Cape Breton sheet 19 (Hugh Fletcher, 1884); transcribed from scans of the David Rumsey Map Collection.</p>'
      + COUNTY('six uncertain residences are excluded, and the map has no Judique village inset') + SHARED }),
});
export const HISTORY_AREA_IDS = Object.keys(HISTORY_AREAS) as HistoryAreaId[];
export const historyArea = (id: string | null | undefined): HistoryArea | null =>
  id && Object.hasOwn(HISTORY_AREAS, id) ? HISTORY_AREAS[id as HistoryAreaId] : null;
/** Title-card link from today's area into its 1884 era. */
export const eraDoorText = (name: string): string => `Go back to ${name} in 1884 →`;
/** The 1884 area an era object belongs to: its own area, else the area whose title it carries, else Mabou. */
export function eraAreaId(era: { readonly title: string | null; readonly area?: string }): HistoryAreaId {
  return historyArea(era.area)?.id ?? Object.values(HISTORY_AREAS).find(a => a.title === era.title)?.id ?? 'mabou';
}
