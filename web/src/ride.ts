import type { Vehicle, Input } from './vehicle';

export interface RideInput extends Input { pull?: boolean }
export interface JumpRecord {
  airTime: number;
  peakHeight: number;
  distance: number;
  /** Signed whole turns: positive is a backflip, negative a frontflip. */
  pitchRotations: number;
  clean: boolean;
}
/** Public driving contract, with optional stunt telemetry. Towing hooks belong to the concrete Vehicle. */
export type Ride = Omit<Pick<Vehicle, keyof Vehicle>, 'update' | 'towLoad' | 'beforeStep' | 'onPlaced' | 'checkpointGround'> & {
  update(dt: number, input: RideInput, afterStep?: () => void): void;
  readonly jump?: JumpRecord;
  readonly lastJump?: JumpRecord | null;
};
/** Legacy scene signatures name the concrete class; they use only this public contract. */
export function legacyVehicle(ride: Ride): Vehicle { return ride as Vehicle; }
