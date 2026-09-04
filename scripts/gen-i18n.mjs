// Genera src/i18n/bundled.mjs con imports estáticos de todos los JSON de traducción.
// Motivo: el CLI y el guard se despliegan como un solo archivo y no pueden leer src/i18n/ del disco.
// El JSON sigue siendo la única fuente: este archivo solo lo re-exporta.
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N = join(ROOT, 'src', 'i18n');
const langs = ['es', 'en'];
const imports = [];
const entries = {};

for (const lang of langs) {
  const dir = join(I18N, lang);
  if (!existsSync(dir)) continue;
  entries[lang] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const ns = f.replace(/\.json$/, '');
    const id = `${lang}_${ns.replace(/[^a-zA-Z0-9]/g, '_')}`;
    imports.push(`import ${id} from './${lang}/${f}' with { type: 'json' };`);
    entries[lang].push(`  '${ns}': ${id},`);
  }
}

const body = [
  '// GENERADO por scripts/gen-i18n.mjs — no editar a mano. Ejecuta: npm run build',
  ...imports,
  '',
  'export const BUNDLED = {',
  ...langs.filter((l) => entries[l]).map((l) => [`  ${l}: {`, ...entries[l].map((e) => '  ' + e), '  },'].join('\n')),
  '};',
  '',
].join('\n');

writeFileSync(join(I18N, 'bundled.mjs'), body);
console.log(`src/i18n/bundled.mjs: ${imports.length} archivos de traducción`);
