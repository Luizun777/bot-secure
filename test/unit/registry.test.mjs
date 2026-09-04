// El registro estático de comandos y las traducciones incrustadas deben estar al día:
// si alguien añade un comando o un idioma y no ejecuta el generador, el binario
// empaquetado se queda sin ese comando o sin esos mensajes. Esta prueba lo impide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('src/cli/_registry.mjs incluye todos los comandos de src/cli/', () => {
  const registro = readFileSync(join(ROOT, 'src', 'cli', '_registry.mjs'), 'utf8');
  const archivos = readdirSync(join(ROOT, 'src', 'cli')).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));
  const faltan = archivos.filter((f) => !registro.includes(`'./${f}'`));
  assert.deepEqual(faltan, [], `Ejecuta: node scripts/gen-commands.mjs — faltan: ${faltan.join(', ')}`);
});

test('src/i18n/bundled.mjs incluye todos los archivos de traducción', () => {
  const bundled = readFileSync(join(ROOT, 'src', 'i18n', 'bundled.mjs'), 'utf8');
  const faltan = [];
  for (const lang of ['es', 'en']) {
    const dir = join(ROOT, 'src', 'i18n', lang);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      if (!bundled.includes(`'./${lang}/${f}'`)) faltan.push(`${lang}/${f}`);
    }
  }
  assert.deepEqual(faltan, [], `Ejecuta: node scripts/gen-i18n.mjs — faltan: ${faltan.join(', ')}`);
});

test('el guard es una librería pura: no se autoejecuta al importarlo', () => {
  const src = readFileSync(join(ROOT, 'src', 'guard', 'guard.mjs'), 'utf8');
  assert.doesNotMatch(src, /^\s*main\(/m, 'guard.mjs no debe llamar a main() al cargarse; usa src/guard/entry.mjs');
  assert.ok(existsSync(join(ROOT, 'src', 'guard', 'entry.mjs')), 'falta src/guard/entry.mjs');
});
