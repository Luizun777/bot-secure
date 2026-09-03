// Ejecución de procesos (git, docker, node…) sin shell, con cwd explícito.
import { spawnSync } from 'node:child_process';

/** Ejecuta un binario. Devuelve {status, stdout, stderr}. Nunca lanza: comprueba status. */
export function run(cmd, args = [], { cwd = process.cwd(), input, env, timeout = 120_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, env: env ?? process.env, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** git <args> en cwd. */
export function git(args, opts = {}) { return run('git', args, opts); }

/** ¿Existe el binario en PATH? */
export function which(bin) {
  const r = run(process.platform === 'win32' ? 'where' : 'which', [bin]);
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}
