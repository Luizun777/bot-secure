// Los datos del bot (reglas, catálogos, plantillas) deben viajar DENTRO del binario.
// Leerlos del disco en tiempo de ejecución rompió el despliegue tres veces:
// las reglas del escáner, las plantillas de settings y las plantillas Markdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAssets, readAsset, readAssetJson } from '../../src/assets/index.mjs';
import { ASSETS } from '../../src/assets/bundled.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const posix = (p) => p.split(sep).join('/');

function listarDisco(dir) {
  const out = [];
  const rec = (d) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); statSync(p).isDirectory() ? rec(p) : out.push(posix(relative(dir, p))); } };
  rec(dir);
  return out;
}

const GRUPOS = [
  ['rules', join(ROOT, 'src', 'engine', 'rules')],
  ['catalogs', join(ROOT, 'src', 'engine', 'catalogs')],
  ['templates', join(ROOT, 'templates')],
];

for (const [grupo, dir] of GRUPOS) {
  test(`los datos de ${grupo} están incrustados y al día`, () => {
    const enDisco = listarDisco(dir);
    const incrustados = Object.keys(ASSETS[grupo] ?? {});
    const faltan = enDisco.filter((f) => !incrustados.includes(f));
    assert.deepEqual(faltan, [], `Ejecuta: node scripts/gen-assets.mjs — faltan: ${faltan.join(', ')}`);
    for (const f of enDisco) {
      assert.equal(ASSETS[grupo][f], readFileSync(join(dir, ...f.split('/')), 'utf8'),
        `${grupo}/${f} cambió en disco: ejecuta node scripts/gen-assets.mjs`);
    }
  });
}

test('readAsset devuelve el contenido y readAssetJson lo parsea', () => {
  assert.ok(listAssets('rules').includes('prefixed.json'));
  const t = readAsset('rules', 'prefixed.json');
  assert.ok(t && t.length > 100);
  const j = readAssetJson('rules', 'prefixed.json');
  assert.ok(Array.isArray(j.rules ?? j), 'prefixed.json debe traer reglas');
  assert.equal(readAsset('rules', 'no-existe.json'), null);
});

test('ningún módulo lee datos del repo con rutas relativas al código', () => {
  // Excepciones legítimas: el acceso a datos (que sirve de disco en desarrollo),
  // i18n (mismo patrón) y init (busca dist/guard.mjs, un archivo hermano del binario).
  const permitidos = ['src/assets/index.mjs', 'src/lib/i18n.mjs', 'src/cli/init.mjs'];
  const sospechosos = [];
  const rec = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { rec(p); continue; }
      if (!f.endsWith('.mjs')) continue;
      const rel = posix(relative(ROOT, p));
      if (permitidos.includes(rel)) continue;
      const src = readFileSync(p, 'utf8');
      // Dos formas de leer del disco que ya rompieron el despliegue:
      //   join(HERE, '..', 'templates', …)      y      new URL('./rules/x.json', import.meta.url)
      const porJoin = /join\(HERE[^)]*'(templates|rules|catalogs)'/.test(src);
      const porUrl = /new URL\(\s*[`'"]\.\/(rules|catalogs|templates)\//.test(src);
      if (porJoin || porUrl) sospechosos.push(rel);
    }
  };
  rec(join(ROOT, 'src'));
  assert.deepEqual(sospechosos, [], `Usa src/assets/index.mjs en vez de leer el disco: ${sospechosos.join(', ')}`);
});
