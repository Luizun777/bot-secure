// Regresiones encontradas atacando el binario real (campaña de red team).
// Cada caso aquí falló alguna vez de verdad: si vuelve a fallar, es una fuga.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../src/guard/bash-parser.mjs';
import { isInside, isGuardPath, relativoALaRaiz } from '../../src/policy/sensitive.mjs';

const ws = mkdtempSync(join(tmpdir(), 'bs-ev-'));   // en macOS cuelga de /var → /private/var
mkdirSync(join(ws, 'backend'), { recursive: true });
mkdirSync(join(ws, '.claude', 'hooks'), { recursive: true });
writeFileSync(join(ws, 'backend', '.env'), 'AWS_ACCESS_KEY_ID=AKIAAIPLACEHOLDER000\n');
writeFileSync(join(ws, 'backend', 'package.json'), '{}');
const fuera = mkdtempSync(join(tmpdir(), 'bs-fuera-'));
writeFileSync(join(fuera, 'secreto.txt'), 'x');
try { symlinkSync(fuera, join(ws, 'enlace')); } catch { /* sin permisos: se omite ese caso */ }

const lee = (cmd) => analyze(cmd, { cwd: ws }).segments.flatMap((s) => s.reads ?? []);
const escribe = (cmd) => analyze(cmd, { cwd: ws }).segments.flatMap((s) => s.writes ?? []);

test('los envoltorios no esconden un lector', () => {
  const casos = [
    'find backend -name ".env" -exec cat {} \;',
    'find . -name "*.env" -execdir base64 {} \;',
    'eval "cat backend/.env"',
    'timeout 5 cat backend/.env',
    'nice -n 10 cat backend/.env',
    'command cat backend/.env',
    'nohup cat backend/.env',
    'sudo cat backend/.env',
    'sh -c "cat backend/.env"',
    'find backend -name ".env" | xargs cat',
  ];
  for (const c of casos) assert.ok(lee(c).length > 0, `no detecta la lectura escondida: ${c}`);
});

test('el patrón de grep no tapa la ruta que se lee', () => {
  assert.ok(lee('grep -r CLAVE backend').length > 0, 'grep -r debe declarar la carpeta que recorre');
  assert.ok(lee('grep CLAVE backend/.env').length > 0);
  assert.equal(lee('echo hola').length, 0, 'un comando inocuo no debe declarar lecturas');
});

test('la edición en sitio cuenta como escritura', () => {
  assert.ok(escribe('sed -i "" s/a/b/ .claude/hooks/guard.mjs').length > 0, 'sed -i debe ser escritura');
  assert.ok(escribe('perl -i -pe s/a/b/ .claude/settings.json').length > 0, 'perl -i debe ser escritura');
  assert.equal(escribe('sed -n 1p backend/package.json').length, 0, 'sed sin -i solo lee');
});

test('la contención resuelve enlaces simbólicos en ambos lados (macOS /tmp → /private/tmp)', () => {
  const real = realpathSync(ws);
  assert.ok(isInside(join(real, 'backend', 'package.json'), ws), 'un archivo del workspace debe considerarse dentro aunque llegue por su ruta real');
  assert.ok(isInside(join(real, 'backend', 'aun-no-existe.js'), ws), 'un archivo por crear también está dentro');
  assert.ok(!isInside(join(fuera, 'secreto.txt'), ws), 'lo de fuera queda fuera');
  assert.equal(relativoALaRaiz(join(fuera, 'secreto.txt'), ws), null);
});

test('un enlace simbólico no saca contenido del workspace', (t) => {
  const enlace = join(ws, 'enlace', 'secreto.txt');
  try { realpathSync(enlace); } catch { return t.skip('no se pudo crear el enlace'); }
  assert.ok(!isInside(enlace, ws), 'lo que apunta fuera debe quedar fuera aunque el enlace esté dentro');
});

test('las propias guardas se reconocen por su ruta real', () => {
  const real = realpathSync(ws);
  for (const p of ['.claude/hooks/guard.mjs', '.claude/settings.json', '.githooks/pre-commit', '.bot-secure/lock.json', '.env.ai']) {
    assert.ok(isGuardPath(join(real, ...p.split('/')), ws), `debe protegerse: ${p}`);
  }
  assert.ok(!isGuardPath(join(real, 'backend', 'src', 'x.js'), ws), 'el código normal no es una guarda');
});

process.on('exit', () => { rmSync(ws, { recursive: true, force: true }); rmSync(fuera, { recursive: true, force: true }); });
