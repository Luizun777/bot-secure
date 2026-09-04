// `bot-secure up`: alias de `db up` + `mocks up`. El módulo de mocks se carga de forma dinámica:
// si todavía no existe en esta versión se dice con su arreglo y el resto sigue funcionando.
import { EXIT } from '../lib/errors.mjs';
import { errText, requireWorkspace } from './doctor.mjs';

/**
 * Ejecuta `fn` del módulo `spec`; si el módulo no está, avisa con el arreglo y devuelve null.
 * @returns {Promise<object|null>}
 */
export async function callModule(ctx, spec, name, fn, args) {
  const { log, t } = ctx;
  let mod;
  try { mod = await import(spec); } catch { mod = null; }
  if (!mod || typeof mod[fn] !== 'function') {
    log.warn(t('cli-core.moduleMissing', { module: name }));
    log.info(t('cli-core.fixLine', { fix: `bot-secure ${name} --help` }));
    return null;
  }
  return mod[fn](...args);
}

/** Una línea con el resultado de la base de datos (el detalle vive en `bot-secure db status`). */
function reportDb(ctx, res) {
  const { log, t } = ctx;
  if (!res || res.dryRun) return;
  if (res.mode === 'embedded') { log.warn(t('cli-core.dbNoRuntime')); return; }
  if (res.port) log.ok(t('cli-core.dbOk', { engine: res.engine ?? '?', port: res.port }));
}

export default {
  name: 'up',
  aliases: [],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Levanta la base de datos de pruebas y los mocks',
    en: 'Bring the test database and the mocks up',
  },
  usage: { es: 'bot-secure up [--json]', en: 'bot-secure up [--json]' },
  async run(ctx) {
    const { log, t } = ctx;
    const { root, policy } = requireWorkspace(ctx);
    const out = { command: 'up', root, db: null, mocks: null };
    log.step(t('cli-core.upDb'));
    try {
      out.db = await callModule(ctx, '../db/index.mjs', 'db', 'up', [root, policy, { log, t, dryRun: ctx.dryRun }]);
      reportDb(ctx, out.db);
    } catch (e) {
      log.warn(t('cli-core.dbFailed', { message: errText(ctx, e) }));
      log.info(t('cli-core.fixLine', { fix: e?.fix ?? 'bot-secure db status' }));
      out.db = { ok: false };
    }
    log.step(t('cli-core.upMocks'));
    try {
      out.mocks = await callModule(ctx, '../mocks/index.mjs', 'mocks', 'up', [root, policy, { log, t, dryRun: ctx.dryRun }]);
    } catch (e) {
      log.warn(t('cli-core.moduleMissing', { module: 'mocks' }));
      log.info(t('cli-core.fixLine', { fix: e?.fix ?? 'bot-secure doctor' }));
      out.mocks = { ok: false };
    }
    log.ok(t('cli-core.upDone'));
    log.data(out);
    return EXIT.OK;
  },
};
