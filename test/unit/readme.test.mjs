// El README y docs/ deben mantenerse fáciles: cortos, con el camino principal visible,
// y documentando todos los comandos que el CLI expone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

test('el README cabe en 250 líneas', () => {
  const lines = readme.split('\n').length;
  assert.ok(lines <= 250, `README tiene ${lines} líneas (máximo 250). Mueve lo avanzado a docs/.`);
});

test('el bloque "Empieza" tiene como máximo 3 comandos', () => {
  const bloque = readme.split('## Empieza en 3 comandos')[1]?.split('```')[1] ?? '';
  // la primera línea de la valla es la etiqueta del lenguaje (bash), no un comando
  const comandos = bloque.split('\n').slice(1).filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.ok(comandos.length <= 3, `El primer bloque tiene ${comandos.length} comandos; deben ser 3 o menos.`);
});

test('el README enseña el camino principal: start y claude', () => {
  assert.match(readme, /bot-secure start/);
  assert.match(readme, /bot-secure claude/);
});

test('todos los comandos del CLI están documentados en README o docs/comandos.md', async () => {
  const docs = readme + readFileSync(join(ROOT, 'docs', 'comandos.md'), 'utf8');
  const dir = join(ROOT, 'src', 'cli');
  const faltan = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.mjs') || f.startsWith('_')) continue;
    const mod = await import(pathToFileURL(join(dir, f)).href);
    const def = mod.default;
    if (!def?.name || def.hidden) continue;
    if (!docs.includes(`${def.name}`)) faltan.push(def.name);
  }
  assert.deepEqual(faltan, [], `Comandos sin documentar: ${faltan.join(', ')}`);
});

test('cada enlace a docs/ del README existe', () => {
  const enlaces = [...readme.matchAll(/\]\((docs\/[\w.-]+\.md)\)/g)].map((m) => m[1]);
  assert.ok(enlaces.length > 0, 'El README debería enlazar a docs/');
  for (const e of new Set(enlaces)) {
    assert.doesNotThrow(() => readFileSync(join(ROOT, e), 'utf8'), `Enlace roto en el README: ${e}`);
  }
});
