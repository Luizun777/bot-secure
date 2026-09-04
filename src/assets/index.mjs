// Acceso a los datos del bot (reglas, catálogos, plantillas) que funciona en los dos modos:
// desde el repo lee el disco (permite editar sin recompilar) y desde dist/ usa lo incrustado.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS } from './bundled.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const posix = (p) => p.split(sep).join('/');

const DIRS = {
  rules: join(HERE, '..', 'engine', 'rules'),
  catalogs: join(HERE, '..', 'engine', 'catalogs'),
  templates: join(HERE, '..', '..', 'templates'),
};

/** ¿Está disponible el árbol de fuentes? (falso desde el bundle) */
function hayDisco(grupo) {
  const d = DIRS[grupo];
  return !!d && existsSync(d);
}

/** Nombres de archivo de un grupo ('rules' | 'catalogs' | 'templates'), rutas con '/'. */
export function listAssets(grupo) {
  if (hayDisco(grupo)) {
    const dir = DIRS[grupo];
    const out = [];
    const rec = (d) => {
      for (const f of readdirSync(d).sort()) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) rec(p); else out.push(posix(relative(dir, p)));
      }
    };
    rec(dir);
    return out;
  }
  return Object.keys(ASSETS[grupo] ?? {});
}

/** Contenido de un archivo de datos. Devuelve null si no existe. */
export function readAsset(grupo, nombre) {
  const rel = posix(nombre);
  if (hayDisco(grupo)) {
    const p = join(DIRS[grupo], ...rel.split('/'));
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return ASSETS[grupo]?.[rel] ?? null;
}

/** Igual que readAsset pero parseando JSON. */
export function readAssetJson(grupo, nombre) {
  const t = readAsset(grupo, nombre);
  return t == null ? null : JSON.parse(t);
}

/** ¿Existe ese archivo de datos? */
export function hasAsset(grupo, nombre) {
  return readAsset(grupo, nombre) !== null;
}
