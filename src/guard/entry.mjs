#!/usr/bin/env node
// Punto de entrada del guard: es lo que se empaqueta como dist/guard.mjs y se copia al workspace.
// Dos formas de uso, ambas necesarias:
//  1. Claude Code lo ejecuta directo:  node .claude/hooks/guard.mjs <evento>   → se autoejecuta.
//  2. El lanzador de hooks git lo importa y llama a main()                     → NO debe autoejecutarse.
// La distinción se hace comparando RUTAS REALES, porque en macOS /tmp y /var son enlaces
// simbólicos y comparar import.meta.url con argv[1] daba siempre falso (el guard no arrancaba
// y Claude Code lo interpretaba como "permitido").
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './guard.mjs';

export { main };

function esProcesoPrincipal() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

function leerStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

if (esProcesoPrincipal()) {
  const evento = process.argv[2] ?? 'pre-tool';
  main(evento, leerStdin()).then(
    (code) => process.exit(typeof code === 'number' ? code : 2),
    (e) => { try { process.stderr.write(`bot-secure: ${e?.message ?? e}\n`); } catch {} process.exit(2); },
  );
}
