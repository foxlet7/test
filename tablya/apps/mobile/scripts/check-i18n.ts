// Fails when the English and Arabic dictionaries drift apart, or when a screen uses a key that doesn't exist.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { messages } from '../../../packages/shared/src/i18n.ts';
import { local } from '../src/lib/strings.ts';

const problems: string[] = [];
const en = { ...messages.en, ...local.en };
const ar = { ...messages.ar, ...local.ar };
for (const k of Object.keys(en)) if (!(k in ar)) problems.push(`missing in ar: ${k}`);
for (const k of Object.keys(ar)) if (!(k in en)) problems.push(`missing in en: ${k}`);
for (const k of Object.keys(local.ar)) if (/^[\x00-\x7F]+$/.test(local.ar[k]) && !/^(WELCOME|[A-Z]{2,})/.test(local.ar[k])) problems.push(`ar value looks untranslated: ${k}`);

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' || f === 'dist' ? [] : walk(p)) : /\.tsx?$/.test(f) ? [p] : []; });
const used = new Set<string>();
for (const f of [...walk('app'), ...walk('src')]) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(m[1]);
for (const k of used) if (!(k in en)) problems.push(`used but undefined: ${k}`);

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`i18n OK: ${Object.keys(en).length} keys, ${used.size} used in code`);
