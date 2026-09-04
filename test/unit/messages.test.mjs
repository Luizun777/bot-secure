// Regla del proyecto: todo mensaje de error que ve el usuario debe decir cómo arreglarlo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const I18N = join(ROOT, 'src', 'i18n');

const cargar = (lang) => {
  const dir = join(I18N, lang);
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  }
  return out;
};

test('todo namespace en español tiene su equivalente en inglés', () => {
  const es = cargar('es'), en = cargar('en');
  const faltan = Object.keys(es).filter((ns) => !(ns in en));
  assert.deepEqual(faltan, [], `Faltan traducciones al inglés: ${faltan.join(', ')}`);
});

test('las claves de cada namespace coinciden entre idiomas', () => {
  const es = cargar('es'), en = cargar('en');
  const problemas = [];
  for (const ns of Object.keys(es)) {
    if (!en[ns]) continue;
    for (const k of Object.keys(es[ns])) if (!(k in en[ns])) problemas.push(`${ns}.${k} falta en inglés`);
  }
  assert.deepEqual(problemas, [], problemas.join('\n'));
});

test('los archivos de i18n son JSON válido y sin valores vacíos', () => {
  for (const lang of ['es', 'en']) {
    const dict = cargar(lang);
    for (const [ns, obj] of Object.entries(dict)) {
      for (const [k, v] of Object.entries(obj)) {
        assert.equal(typeof v, 'string', `${lang}/${ns}.${k} debe ser texto`);
        assert.ok(v.trim().length > 0, `${lang}/${ns}.${k} está vacío`);
      }
    }
  }
});

test('los mensajes no contienen marcadores de plantilla sin cerrar', () => {
  for (const lang of ['es', 'en']) {
    for (const [ns, obj] of Object.entries(cargar(lang))) {
      for (const [k, v] of Object.entries(obj)) {
        const abren = (v.match(/\{/g) || []).length, cierran = (v.match(/\}/g) || []).length;
        assert.equal(abren, cierran, `${lang}/${ns}.${k}: llaves desbalanceadas`);
      }
    }
  }
});
