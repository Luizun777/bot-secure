// Runtime de contenedores (Docker/Podman) y utilidades de `compose` para la BD de pruebas.
// Prefiere la implementación compartida de src/detect (import dinámico, por si aún no aterriza)
// y cae a la implementación local de respaldo.
import { run, which } from '../lib/exec.mjs';

/** @typedef {{kind:'docker'|'podman'|null, compose:string[], bin?:string}} ContainerRuntime */

/**
 * Detección local (respaldo): busca docker y luego podman en el PATH y decide el `compose`.
 * @param {{env?:NodeJS.ProcessEnv}} [opts]
 * @returns {ContainerRuntime}
 */
export function detectContainerRuntime({ env = process.env } = {}) {
  const ok = (bin, args) => run(bin, args, { env, timeout: 8000 }).status === 0;
  for (const [kind, plugin, legacy] of [['docker', 'docker', 'docker-compose'], ['podman', 'podman', 'podman-compose']]) {
    const bin = which(kind);
    if (!bin) continue;
    if (ok(bin, ['compose', 'version'])) return { kind, compose: [plugin, 'compose'], bin };
    if (which(legacy)) return { kind, compose: [legacy], bin };
    return { kind, compose: [], bin };
  }
  return { kind: null, compose: [] };
}

let cache = null;

/**
 * Runtime efectivo: usa `src/detect` si existe (para no duplicar la detección) y si no, el respaldo.
 * @param {{env?:NodeJS.ProcessEnv, refresh?:boolean}} [opts]
 * @returns {Promise<ContainerRuntime>}
 */
export async function containerRuntime({ env = process.env, refresh = false } = {}) {
  if (cache && !refresh) return cache;
  let rt = null;
  try {
    const mod = await import('../detect/system.mjs');
    if (typeof mod.detectContainerRuntime === 'function') rt = mod.detectContainerRuntime({ env });
  } catch { /* src/detect todavía no existe: se usa el respaldo */ }
  cache = rt && typeof rt.kind !== 'undefined' ? rt : detectContainerRuntime({ env });
  return cache;
}

/** Olvida el runtime cacheado (para pruebas). */
export function resetRuntimeCache() { cache = null; }

/**
 * Construye la invocación de `compose` para un archivo y proyecto dados.
 * @returns {{bin:string, argv:string[]}}
 */
export function composeInvocation(runtime, { file, project, args = [] }) {
  const compose = runtime?.compose ?? [];
  if (!compose.length) throw new Error('sin compose');
  const [bin, ...rest] = compose;
  return { bin, argv: [...rest, '-p', project, '-f', file, ...args] };
}

/** Ejecuta `compose <args>`; devuelve {status, stdout, stderr}. */
export function compose(runtime, { file, project, cwd, args = [], timeout = 300_000 }) {
  const { bin, argv } = composeInvocation(runtime, { file, project, args });
  return run(bin, argv, { cwd, timeout });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Estado de salud del contenedor según `inspect`.
 * @returns {'healthy'|'unhealthy'|'starting'|'none'|'missing'}
 */
export function healthOf(runtime, container) {
  if (!runtime?.bin) return 'missing';
  const r = run(runtime.bin, ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}none{{else}}missing{{end}}{{end}}', container], { timeout: 15_000 });
  if (r.status !== 0) return 'missing';
  const s = r.stdout.trim();
  return ['healthy', 'unhealthy', 'starting', 'none'].includes(s) ? s : 'missing';
}

/**
 * Espera a que el contenedor esté `healthy` (o al menos corriendo si no declara healthcheck).
 * @param {ContainerRuntime} runtime
 * @param {{container:string, timeoutMs?:number, intervalMs?:number, onTick?:(s:string,ms:number)=>void}} opts
 * @returns {Promise<{ok:boolean, status:string, ms:number}>}
 */
export async function waitHealthy(runtime, { container, timeoutMs = 90_000, intervalMs = 2000, onTick } = {}) {
  const t0 = Date.now();
  let status = 'missing';
  for (;;) {
    status = healthOf(runtime, container);
    const ms = Date.now() - t0;
    if (status === 'healthy' || status === 'none') return { ok: true, status, ms };
    if (onTick) onTick(status, ms);
    if (ms >= timeoutMs) return { ok: false, status, ms };
    await sleep(intervalMs);
  }
}

/** Ejecuta un comando DENTRO del contenedor de la BD (`compose exec -T db …`). */
export function execInDb(runtime, { file, project, cwd, service = 'db', argv, timeout = 300_000 }) {
  return compose(runtime, { file, project, cwd, args: ['exec', '-T', service, ...argv], timeout });
}
