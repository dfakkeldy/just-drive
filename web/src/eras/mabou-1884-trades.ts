/**
 * Mabou, 1884: trades and services printed on the 1884 Geological Survey of Canada sheets of Cape Breton
 * (Hugh Fletcher; sheet 16, Port Hood and Mabou, and sheet 14, Cape Mabou and Broad Cove).
 *
 * Each row is the place of the PRINTED WORD on the sheet, moved to today's map (EPSG:2961, metres). It is not the
 * place of a building: expect 100 to 250 m of error. `word` is the sheet's own wording. `source` is the sheet and the
 * label's number in the transcription. The transcription was made from scans of the David Rumsey Map Collection.
 * No scan pixels are in this repository. No names of people: the sheets print some, and this file leaves them out.
 * Do not add any.
 */
export type TradeKind = 'school' | 'forge' | 'shop' | 'mill' | 'post-office' | 'church' | 'factory' | 'tannery' | 'stables' | 'quarry';
export interface Trade1884 { id: string; kind: TradeKind; word: string; e: number; n: number; source: string }
const t = (id: string, kind: TradeKind, word: string, e: number, n: number, sheet: number): Trade1884 =>
  ({ id, kind, word, e, n, source: `Geological Survey of Canada, Cape Breton sheet ${sheet} (1884), label ${id}` });
export const MABOU_1884_TRADES: readonly Trade1884[] = Object.freeze([
  t('F14-CMB-112', 'mill', "Mill", 619751, 5110969, 14),
  t('F14-CMB-117', 'post-office', "P.O.", 619219, 5109825, 14),
  t('F14-CMB-135', 'school', "School", 630688, 5109110, 14),
  t('F14-CMB-152', 'mill', "Mill", 626227, 5107892, 14),
  t('F14-CMB-154', 'school', "School", 627179, 5107685, 14),
  t('F14-CMB-155', 'mill', "Saw Mill", 628600, 5107692, 14),
  t('F14-CMB-157', 'shop', "Shop", 627553, 5106530, 14),
  t('F14-CMB-163', 'school', "School", 619158, 5110740, 14),
  t('F14-CMB-164', 'post-office', "P.O.", 628487, 5110116, 14),
  t('F14-CMB-165', 'forge', "Forge", 628254, 5109433, 14),
  t('F16-PHM-005', 'quarry', "Plaster Quarry", 619252, 5105159, 16),
  t('F16-PHM-006', 'school', "School", 619461, 5104989, 16),
  t('F16-PHM-007', 'factory', "Lobster Factory", 618948, 5104550, 16),
  t('F16-PHM-019', 'forge', "Forge", 620640, 5104914, 16),
  t('F16-PHM-021', 'post-office', "P.O.", 621623, 5104645, 16),
  t('F16-PHM-022', 'shop', "Shop", 621233, 5104489, 16),
  t('F16-PHM-023', 'school', "School", 623608, 5105180, 16),
  t('F16-PHM-024', 'church', "R.C. Ch.", 623486, 5103805, 16),
  t('F16-PHM-042', 'mill', "Weaving Mills", 627415, 5105465, 16),
  t('F16-PHM-044', 'factory', "Cheese Factory", 627656, 5104267, 16),
  t('F16-PHM-045', 'church', "Church", 626897, 5103770, 16),
  t('F16-PHM-046', 'tannery', "Tannery", 627446, 5103612, 16),
  t('F16-PHM-047', 'shop', "Shop", 627337, 5103503, 16),
  t('F16-PHM-048', 'church', "Church", 627689, 5103328, 16),
  t('F16-PHM-049', 'school', "School", 628009, 5103164, 16),
  t('F16-PHM-050', 'stables', "Stage Stables", 624831, 5103702, 16),
  t('F16-PHM-052', 'post-office', "T. & P.O.", 624268, 5103470, 16),
  t('F16-PHM-053', 'school', "School", 624609, 5103235, 16),
  t('F16-PHM-054', 'forge', "Forge", 628394, 5102791, 16),
  t('F16-PHM-055', 'post-office', "P.O.", 628445, 5102624, 16),
  t('F16-PHM-056', 'shop', "Shops", 628915, 5102606, 16),
  t('F16-PHM-057', 'mill', "Mill", 628723, 5102395, 16),
  t('F16-PHM-061', 'mill', "Mills", 629571, 5102788, 16),
  t('F16-PHM-108', 'school', "School", 619889, 5100331, 16),
  t('F16-PHM-109', 'school', "School", 619798, 5097842, 16),
  t('F16-PHM-117', 'forge', "Forge", 624382, 5098025, 16),
  t('F16-PHM-118', 'school', "School", 624379, 5097924, 16),
  t('F16-PHM-124', 'school', "School", 628310, 5097570, 16),
  t('F16-PHM-125', 'mill', "Shingle Mill", 628663, 5097332, 16),
  t('F16-PHM-127', 'mill', "Mill", 632032, 5101456, 16),
  t('F16-PHM-128', 'post-office', "P.O.", 631577, 5101381, 16),
  t('F16-PHM-129', 'school', "School", 631254, 5101219, 16),
  t('F16-PHM-130', 'forge', "Forge", 631525, 5101103, 16),
  t('F16-PHM-131', 'tannery', "Tannery", 630761, 5100941, 16),
  t('F16-PHM-132', 'mill', "Mill", 631849, 5101019, 16),
  t('F16-PHM-136', 'mill', "Mill", 630657, 5098790, 16),
  t('F16-PHM-195', 'shop', "Shop", 631599, 5101097, 16),
  t('F16-PHM-198', 'post-office', "P.O.", 619971, 5097910, 16),
]);
