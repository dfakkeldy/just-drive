import type { Point } from './cemetery-rules';

/**
 * Grave markers measured from the owner's phone scan of the church cemetery (EPSG:2961).
 * Each row: east, north, shape, tone, width, height, thickness (metres), and the compass bearing the face looks toward.
 * The shapes and tones come from the owner's photos. These are anonymous shapes: no names, dates or inscriptions.
 */
export type MeasuredRow = [east: number, north: number, shape: number, tone: number, w: number, h: number, t: number, facing: number];

/** Shapes: 3 rounded tablet, 4 shouldered tablet, 5 pedestal, 6 stone cross on a base, 7 small post. */
export const MEASURED_SHAPES = [3, 4, 5, 6, 7] as const;
/** Tones: 0 dark slate, 1 grey granite, 2 white marble. */
export const TONES: [number, number, number][] = [[0.20, 0.21, 0.23], [0.45, 0.46, 0.46], [0.78, 0.78, 0.75]];

export const MEASURED_STONES: Record<string, MeasuredRow[]> = {
  // The church cemetery on River Denys Mountain: every upright marker the scan shows clearly.
  'cemetery-e26f6ceae9b8': [
    [630857.08, 5080567.84, 5, 0, 0.97, 1.06, 0.35, 108],
    [630859.27, 5080565.30, 4, 0, 0.63, 0.79, 0.30, 107],
    [630868.03, 5080564.66, 3, 1, 0.94, 0.77, 0.27, 346.4],
    [630883.52, 5080562.22, 3, 2, 0.45, 0.90, 0.30, 153.8],
    [630861.85, 5080561.63, 5, 0, 0.81, 1.10, 0.50, 127.4],
    [630884.36, 5080561.11, 3, 1, 0.51, 0.94, 0.30, 158.8],
    [630892.77, 5080561.00, 3, 2, 0.72, 1.37, 0.30, 300],
    [630867.32, 5080560.20, 6, 1, 1.00, 2.62, 1.00, 300],
    [630863.22, 5080559.74, 3, 1, 0.44, 0.97, 0.30, 302.5],
    [630868.30, 5080558.56, 6, 1, 0.84, 2.64, 0.77, 300],
    [630895.50, 5080557.74, 3, 1, 0.54, 1.19, 0.30, 107.3],
    [630890.79, 5080556.13, 4, 0, 0.45, 0.82, 0.30, 122.8],
    [630869.67, 5080555.45, 4, 0, 0.65, 1.11, 0.30, 134],
    [630882.10, 5080551.76, 3, 1, 0.51, 0.96, 0.30, 104.8],
    [630890.33, 5080550.10, 4, 0, 0.45, 1.04, 0.30, 300],
    [630890.24, 5080549.16, 7, 0, 0.40, 0.38, 0.27, 119.4],
    [630863.86, 5080548.27, 3, 1, 0.92, 1.14, 0.30, 121.5],
    [630889.58, 5080547.48, 4, 1, 1.30, 1.27, 0.30, 300],
    [630890.88, 5080546.02, 4, 1, 1.17, 1.31, 0.30, 177.7],
    [630859.22, 5080545.61, 3, 1, 0.56, 0.82, 0.30, 122.3],
    [630876.82, 5080542.51, 3, 1, 0.74, 0.73, 0.30, 300],
    [630889.98, 5080541.84, 3, 1, 0.98, 1.29, 0.30, 103.1],
    [630877.57, 5080541.01, 3, 0, 0.52, 1.50, 0.30, 300],
    [630861.92, 5080540.92, 4, 0, 0.74, 0.67, 0.30, 105.4],
    [630872.67, 5080539.74, 5, 1, 0.61, 1.17, 0.37, 113],
    [630888.08, 5080539.44, 3, 1, 0.57, 0.69, 0.30, 110.5],
    [630873.96, 5080538.52, 3, 1, 0.83, 0.78, 0.30, 207.9],
    [630865.12, 5080537.60, 3, 2, 0.59, 1.00, 0.30, 300],
    [630874.39, 5080537.18, 7, 0, 0.23, 0.33, 0.21, 300],
    [630865.85, 5080536.44, 3, 1, 0.76, 0.66, 0.30, 119.7],
    [630871.08, 5080536.18, 3, 2, 0.82, 0.70, 0.30, 284.8],
    [630865.26, 5080535.76, 3, 1, 0.70, 0.85, 0.30, 300],
    [630879.50, 5080532.65, 4, 1, 0.63, 1.43, 0.30, 49.7],
    [630876.58, 5080531.77, 3, 1, 1.30, 1.34, 0.30, 198.4],   // moved 0.2 m in from the mapped wall line, which it crossed
  ],
};
/** The map angle of a marker's width axis (east = 0, counter-clockwise), from the bearing its face looks toward. */
export const measuredTurn = (facing: number): number => -facing * Math.PI / 180;
export const measuredPoint = (r: MeasuredRow): Point => [r[0], r[1]];
