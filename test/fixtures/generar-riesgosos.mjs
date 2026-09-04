// Escribe, en tiempo de prueba, los ficheros de `secrets-falsos/` cuyos valores tienen
// forma de credencial real. Están ignorados por git a propósito: ver valores-falsos.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FICHEROS_GENERADOS } from './valores-falsos.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'secrets-falsos');

/** Crea los ficheros y devuelve sus rutas. */
export function generarRiesgosos() {
  mkdirSync(DIR, { recursive: true });
  const rutas = [];
  for (const [nombre, contenido] of Object.entries(FICHEROS_GENERADOS)) {
    const p = join(DIR, nombre);
    writeFileSync(p, contenido);
    rutas.push(p);
  }
  return rutas;
}
