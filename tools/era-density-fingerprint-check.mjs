// Hash before any terrain/manifest JSON consumer is imported. The base override is for isolated fixtures.
import {getDensityAuditData} from './era-density-data.mjs';
import {verifyDensityInputs} from './era-density-inputs.mjs';
const root=process.env.MMM_ROOT??process.cwd(),area=process.env.DENSITY_AREA??'mabou',base=process.env.DENSITY_FINGERPRINT_BASE??root+(area==='mabou'?'/data/baked/terrain':'/data/baked/areas/'+area);
console.log('PASS land input fingerprints'+(area==='mabou'?'':' '+area),JSON.stringify(verifyDensityInputs(base,getDensityAuditData(area).header.fingerprints)));
