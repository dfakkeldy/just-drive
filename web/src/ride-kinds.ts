// The ride kinds, written once. No imports, so node checks and the room server can load it.
// The order is the replay code (replay-rules.ts rideCode): add a new kind at the end, never reorder.
export const RIDE_KINDS = ['car', 'truck', 'sxs', 'bike', 'horse'] as const;
export type RideId = typeof RIDE_KINDS[number];
/** The rides with an engine. The horse has hooves (horse-sound.ts) and stays off the wire. */
export type MotorKind = Exclude<RideId, 'horse'>;
export const MOTOR_KINDS: readonly MotorKind[] = RIDE_KINDS.filter((kind): kind is MotorKind => kind !== 'horse');
export const isMotorKind = (value: unknown): value is MotorKind => (MOTOR_KINDS as readonly unknown[]).includes(value);
