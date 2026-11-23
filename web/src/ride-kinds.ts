// The ride kinds, written once. No imports, so node checks and the room server can load it.
// The order is the replay code (replay-rules.ts rideCode): add a new kind at the end, never reorder.
export const RIDE_KINDS = ['car', 'truck', 'sxs', 'bike', 'horse', 'sxs-utility', 'sxs-crew', 'sxs-cabin'] as const;
export type RideId = typeof RIDE_KINDS[number];
/** The four generic side-by-side garage models. */
export const SXS_KINDS = ['sxs', 'sxs-utility', 'sxs-crew', 'sxs-cabin'] as const;
export type SxsId = typeof SXS_KINDS[number];
export const isSxsKind = (value: unknown): value is SxsId => (SXS_KINDS as readonly unknown[]).includes(value);
/** The rides with an engine. The horse has hooves (horse-sound.ts) and stays off the wire. */
export type MotorKind = Exclude<RideId, 'horse'>;
export const MOTOR_KINDS: readonly MotorKind[] = RIDE_KINDS.filter((kind): kind is MotorKind => kind !== 'horse');
export const isMotorKind = (value: unknown): value is MotorKind => (MOTOR_KINDS as readonly unknown[]).includes(value);
