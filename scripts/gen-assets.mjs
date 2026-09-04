// Incrusta en src/assets/bundled.mjs todos los archivos de datos del bot:
// reglas, listas de palabras, catálogos y plantillas.
// Motivo: lo que se despliega es dist/ (un solo archivo). Cualquier lectura de disco
// relativa al repo del bot falla en destino, y ya rompió tres veces: las reglas del
// escáner, las plantillas de settings y las plantillas Markdown.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (p) => p.split(sep).join('/');

/** Lista recursiva de archivos de una carpeta, relativa a ella. */
function listar(dir) {
  const out = [];
  const rec = (d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) rec(p);
      else out.push(posix(relative(dir, p)));
    }
  };
  if (existsSync(dir)) rec(dir);
  return out;
}

const grupos = [
  { clave: 'rules', dir: join(ROOT, 'src', 'engine', 'rules') },
  { clave: 'catalogs', dir: join(ROOT, 'src', 'engine', 'catalogs') },
  { clave: 'templates', dir: join(ROOT, 'templates') },
];

const partes = ['// GENERADO por scripts/gen-assets.mjs — no editar a mano. Ejecuta: npm run build', ''];
const mapas = [];
let total = 0;

for (const { clave, dir } of grupos) {
  const archivos = listar(dir);
  const entradas = archivos.map((rel) => {
    total++;
    const texto = readFileSync(join(dir, rel), 'utf8');
    return `  ${JSON.stringify(rel)}: ${JSON.stringify(texto)},`;
  });
  partes.push(`const ${clave} = {`, ...entradas, '};', '');
  mapas.push(`  ${clave},`);
}

partes.push('export const ASSETS = {', ...mapas, '};', '');
writeFileSync(join(ROOT, 'src', 'assets', 'bundled.mjs'), partes.join('\n'));
console.log(`src/assets/bundled.mjs: ${total} archivos de datos incrustados`);
