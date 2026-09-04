// Genera src/cli/_registry.mjs con imports estáticos de todos los comandos.
// Motivo: el CLI se despliega como un solo archivo (dist/bot-secure.mjs). Descubrir los
// comandos con readdirSync + import dinámico hacía que el binario cargara el árbol de
// fuentes del bot: fuera de esa máquina no funcionaba, y al haber dos copias de
// BotSecureError el instanceof fallaba y el usuario veía una traza en vez del arreglo.
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'src', 'cli');

const archivos = readdirSync(CLI).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort();
const ids = archivos.map((f) => ({ f, id: 'cmd_' + f.replace(/\.mjs$/, '').replace(/[^a-zA-Z0-9]/g, '_') }));

const body = [
  '// GENERADO por scripts/gen-commands.mjs — no editar a mano. Ejecuta: npm run build',
  ...ids.map(({ f, id }) => `import ${id} from './${f}';`),
  '',
  'export const COMMANDS = [',
  ...ids.map(({ id }) => `  ${id},`),
  '];',
  '',
].join('\n');

writeFileSync(join(CLI, '_registry.mjs'), body);
console.log(`src/cli/_registry.mjs: ${ids.length} comandos`);
