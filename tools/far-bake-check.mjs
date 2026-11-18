import {execFileSync} from 'node:child_process';
execFileSync('python3',['tools/far-bake-check.py',...process.argv.slice(2)],{stdio:'inherit'});
