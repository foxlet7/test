// Usage: tsx tools/benchmark.ts results.json [maxFalseAccept] [maxFalseReject] [minPerGroup]
// results.json: [{ "id": "...", "label": "correct|incorrect", "predicted": "match|review|unable_to_assess", "group": "..." }]
import { readFileSync } from 'node:fs';
import { evaluateGate, type BenchRecord } from '../services/api/src/benchmark';

const [file, fa = '0.01', fr = '0.2', min = '30'] = process.argv.slice(2);
if (!file) { console.error('usage: benchmark <results.json> [maxFalseAccept] [maxFalseReject] [minPerGroup]'); process.exit(1); }
const rows = JSON.parse(readFileSync(file, 'utf8')) as BenchRecord[];
const res = evaluateGate(rows, { maxFalseAccept: Number(fa), maxFalseReject: Number(fr), minPerGroup: Number(min) });
console.log(JSON.stringify(res, null, 2));
console.log(res.pass ? '\nGATE PASSED — a human decision is still required to enable the flag.' : '\nGATE FAILED — keep the AI pre-check OFF.');
process.exit(res.pass ? 0 : 2);
