/**
 * Judique, 1884: trades and services printed on the 1884 Geological Survey of Canada sheet 19 of Cape Breton
 * (Hugh Fletcher; the Judique sheet).
 *
 * Each row is the place of the PRINTED WORD (or the centre of its printed group) on the sheet, moved to today's map
 * (EPSG:2961, metres) with the reviewed sheet-19 fit (44 controls; fresh checks: median about 120 m, worst about 170 m,
 * from only three fresh checks). It is not the place of a building: expect 100 to 250 m of error.
 * `word` is the sheet's own wording, with one change: a person's name in front of a trade word is left out.
 * `source` is the sheet and the label's number in the transcription.
 *
 * Transcription from the reviewed historical map features.
 * SHA-256 bff7924a6a86f815674d01f6eb16ee2641f3d1a0cad898dc35852d7d43f3e8c9, made from scans of the David Rumsey Map
 * Collection (CC BY-NC-SA 3.0). No scan pixels are in this repository. No names of people: the sheet prints some,
 * and this file leaves them out. Do not add any.
 *
 * Labels that share printed marks keep one building each: F19-JUD-009 Shop and F19-JUD-010 P.O. (three marks);
 * F19-JUD-122 and F19-JUD-123, two shops at one group. Labels within 120 m of the playable edge are left out.
 */
import type { Trade1884, TradeKind } from './mabou-1884-trades';
const t = (id: string, kind: TradeKind, word: string, e: number, n: number): Trade1884 =>
  ({ id, kind, word, e, n, source: `Geological Survey of Canada, Cape Breton sheet 19 (1884), label ${id}` });
export const JUDIQUE_1884_TRADES: readonly Trade1884[] = Object.freeze([
  t('F19-JUD-004', 'school', "School", 618136, 5085968),
  t('F19-JUD-005', 'forge', "Forge", 618015, 5085107),
  t('F19-JUD-006', 'mill', "Sh. Mill", 619298, 5085206),
  t('F19-JUD-007', 'school', "School", 620478, 5084345),
  t('F19-JUD-008', 'stables', "Stage Stables", 617628, 5084008),
  t('F19-JUD-009', 'shop', "Shop", 617727, 5083891),
  t('F19-JUD-010', 'post-office', "P.O.", 617727, 5083891),
  t('F19-JUD-011', 'shop', "Shop", 619201, 5083870),
  t('F19-JUD-013', 'forge', "Forge", 617240, 5082625),
  t('F19-JUD-015', 'church', "R.C. Church", 617129, 5081682),
  t('F19-JUD-018', 'shop', "Shop", 617123, 5081285),
  t('F19-JUD-019', 'school', "School", 618543, 5081266),
  t('F19-JUD-021', 'mill', "Mill", 619673, 5080765),
  t('F19-JUD-024', 'shop', "Shop", 617172, 5079898),
  t('F19-JUD-048', 'post-office', "P.O.", 631087, 5081082),
  t('F19-JUD-050', 'school', "School", 624973, 5079403),
  t('F19-JUD-057', 'school', "School", 630824, 5080686),
  t('F19-JUD-058', 'church', "Church", 630983, 5080811),
  t('F19-JUD-071', 'school', "School", 621458, 5076970),
  t('F19-JUD-072', 'school', "School", 622947, 5077064),
  t('F19-JUD-073', 'school', "School", 621946, 5076770),
  t('F19-JUD-074', 'forge', "Forge", 617991, 5076619),
  t('F19-JUD-077', 'mill', "Mill", 620875, 5075354),
  t('F19-JUD-078', 'mill', "Mills", 618616, 5074465),
  t('F19-JUD-079', 'mill', "Mills", 619493, 5074655),
  t('F19-JUD-082', 'post-office', "P.O.", 618226, 5074004),
  t('F19-JUD-087', 'school', "School", 618854, 5071903),
  t('F19-JUD-089', 'shop', "Shop", 618291, 5071254),
  t('F19-JUD-091', 'school', "School", 623669, 5071385),
  t('F19-JUD-099', 'post-office', "P.O.", 630717, 5074874),
  t('F19-JUD-100', 'school', "School", 630516, 5074764),
  t('F19-JUD-102', 'church', "R.C.Ch.", 630205, 5074250),
  t('F19-JUD-118', 'shop', "Shop", 629717, 5072837),
  t('F19-JUD-119', 'forge', "Forge", 629765, 5072117),
  t('F19-JUD-120', 'shop', "Shop", 630044, 5071682),
  t('F19-JUD-122', 'shop', "Shop", 630777, 5071048),
  t('F19-JUD-123', 'shop', "Shop", 630777, 5071048),
]);
