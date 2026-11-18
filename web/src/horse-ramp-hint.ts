import type {Yard} from './yard';
import type {Vehicle} from './vehicle';
import {SLIP_RAMP} from './yard-site';
/** The animal cannot make the flight judged by the works-yard job. No judge or offer is created. */
export class HorseRampHint {
  readonly judge = {cancel(): void {}};
  private readonly line = document.createElement('p');
  constructor(private readonly yard: Yard, private readonly vehicle: Pick<Vehicle,'x'|'z'>) {
    this.line.id='horseRampHint';this.line.textContent='The jump job needs a motor vehicle. Ride around the ramp.';
    this.line.style.cssText='position:fixed;left:12px;right:12px;bottom:22%;text-align:center;color:#fff;background:#14201be8;padding:10px;z-index:6;font:14px system-ui';
    this.line.hidden=true;document.body.append(this.line);
  }
  step(_dt: number, eligible: boolean, _placement: number): void {
    const p=this.yard.site.local(this.vehicle.x,this.vehicle.z);
    this.line.hidden=!eligible||this.yard.site.mode==='closed'||Math.hypot(p.u-SLIP_RAMP.u,p.v-SLIP_RAMP.v)>30;
  }
  reset(): void {this.line.hidden=true;}
}
