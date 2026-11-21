#!/usr/bin/env node
import { readBaseline } from './baseline-source.mjs';
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {compareWaterShaders} from './water-source-check.mjs';
import {checkShaderBaseline} from './coast-programs.mjs';
const source=readFileSync(new URL('../web/src/shaders.ts',import.meta.url),'utf8');
// Validate the shared committed pin, then isolate each fishing mutant from the
// intentional modern bridge-cut programs added since the old main comparison.
checkShaderBaseline(source,{report:()=>{}});
const main=source,before=readBaseline('fishing-shader','web/src/shaders.ts');
assert.ok(source.includes('#ifdef SITE_GRAVEL\n  float gravelOverlay=0.0;'),'missing mutation anchor SITE_GRAVEL in web/src/shaders.ts');
assert.throws(()=>compareWaterShaders(before,main,()=>{}),/TERRAIN_FRAG differs/,'old shader fails unchanged baseline');
assert.throws(()=>compareWaterShaders(source.replace('#ifdef SITE_GRAVEL\n  float gravelOverlay=0.0;','  float gravelOverlay=0.0;\n#ifdef SITE_GRAVEL'),main,()=>{}),/TERRAIN_FRAG differs/,'unconditional site variable is detected');
assert.throws(()=>compareWaterShaders(source.replace('#ifdef SITE_GRAVEL\n  float gravelOverlay=0.0;','#ifdef MISSING_SITE_GRAVEL\n  float gravelOverlay=0.0;'),main,()=>{}),/SITE_GRAVEL coverage missing/,'new site variant is actually checked');
console.log('PASS source regressions: old LOW text, escaped site variable, and missing SITE_GRAVEL code are rejected; baseline unchanged.');
