// `bot-secure claude`: el lanzador. Comprueba el workspace, construye un entorno con lista
// blanca (para no heredar los tokens del shell del desarrollador) y ejecuta el CLI de Claude Code
// en la raíz del workspace. Sin CLI, imprime las instrucciones de la app de escritorio y sale 0.
import { spawnSync } from 'node:child_process';
import { EXIT } from '../lib/errors.mjs';
import { color } from '../lib/log.mjs';
import { detectClaudeInstall } from '../detect/index.mjs';
import { envAiVars, requireWorkspace } from './doctor.mjs';
import { validatePolicy, verifyIntegrity, isGuardArtifact, readLock } from '../policy/index.mjs';

/** Variables del shell que SÍ se heredan. Todo lo demás (tokens, llaves) se queda fuera. */
export const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
  'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMDATA'];

/**
 * Entorno con lista blanca + variables de `.env.ai` + marcas del ambiente de IA.
 * @returns {{env:object, envAiCount:number}}
 */
export function buildEnv(root, apps = [], { source = process.env } = {}) {
  const env = {};
  for (const k of ENV_ALLOWLIST) if (source[k] !== undefined) env[k] = source[k];
  const vars = envAiVars(root, apps);
  for (const [k, v] of Object.entries(vars)) env[k] = v;
  env.AI_ENV = '1';
  env.BOT_SECURE_LAUNCHED = '1';
  // Menos tráfico no esencial hacia el proveedor (decisión 16 del plan).
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  env.DISABLE_TELEMETRY = '1';
  return { env, envAiCount: Object.keys(vars).length };
}

/** Diagnóstico mínimo antes de abrir: política válida y guardas sin drift. */
export function quickCheck(root, policy) {
  const errors = validatePolicy(policy);
  if (errors.length) return { ok: false, detail: `${errors[0].path}: ${errors[0].message}`, fix: 'bot-secure init' };
  if (!readLock(root)) return { ok: false, detail: 'lock.json', fix: 'bot-secure init' };
  const { ok, drift } = verifyIntegrity(root, { only: isGuardArtifact });
  if (!ok) return { ok: false, detail: drift.map((d) => d.path).join(', '), fix: 'bot-secure init --force' };
  return { ok: true };
}

function desktopInstructions(ctx, root, install) {
  const { log, t } = ctx;
  log.info(color.bold(t('cli-core.claudeDesktopTitle')));
  log.info(`  ${t('cli-core.claudeDesktopStep1')}`);
  log.info(`  ${t('cli-core.claudeDesktopStep2', { root })}`);
  log.info(`  ${t('cli-core.claudeDesktopStep3')}`);
  log.warn(t('cli-core.claudeDesktopWarn'));
  log.info(t('cli-core.fixLine', { fix: 'npm i -g @anthropic-ai/claude-code' }));
  log.data({ command: 'claude', root, launched: false, desktopApp: install.desktopApp ?? null });
  return EXIT.OK;
}

export default {
  name: 'claude',
  aliases: [],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Abre Claude Code en el workspace con el entorno limpio y las guardas activas',
    en: 'Open Claude Code in the workspace with a clean environment and guardrails on',
  },
  usage: {
    es: 'bot-secure claude [-- <argumentos para claude>]',
    en: 'bot-secure claude [-- <arguments for claude>]',
  },
  async run(ctx) {
    const { log, t } = ctx;
    const { root, policy } = requireWorkspace(ctx);
    log.dim(t('cli-core.claudeChecking'));
    const check = quickCheck(root, policy);
    if (!check.ok) {
      log.error(t('cli-core.claudeBlocked', { detail: check.detail }));
      log.info(t('cli-core.fixLine', { fix: check.fix }));
      log.data({ command: 'claude', root, launched: false, blocked: check.detail });
      return EXIT.ERROR;
    }

    const install = detectClaudeInstall();
    const { env, envAiCount } = buildEnv(root, policy.apps ?? []);
    if (envAiCount) log.dim(t('cli-core.claudeEnvVars', { count: envAiCount }));
    else log.warn(t('cli-core.claudeNoEnvAi'));

    // Solo el CLI del PATH: el binario incrustado en la app de escritorio no está soportado
    // como lanzador (la app no permite limpiar el entorno; es nivel best-effort).
    const bin = install.cli;
    if (!bin) return desktopInstructions(ctx, root, install);

    log.step(t('cli-core.claudeLaunching', { root }));
    if (ctx.dryRun) {
      log.data({ command: 'claude', root, launched: false, dryRun: true, bin, envKeys: Object.keys(env).sort() });
      return EXIT.OK;
    }
    const r = spawnSync(bin, ctx.args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    if (r.error) {
      log.error(t('cli-core.claudeFailed', { bin, message: r.error.message }));
      log.info(t('cli-core.fixLine', { fix: 'bot-secure doctor' }));
      return EXIT.ERROR;
    }
    return typeof r.status === 'number' ? r.status : EXIT.OK;
  },
};
