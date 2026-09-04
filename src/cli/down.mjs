// `bot-secure down`: alias de `db down` + `mocks down` (el espejo exacto de `bot-secure up`).
import { EXIT } from '../lib/errors.mjs';
import { errText, requireWorkspace } from './doctor.mjs';
import { callModule } from './up.mjs';

export default {
  name: 'down',
  aliases: [],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Baja la base de datos de pruebas y los mocks',
    en: 'Bring the test database and the mocks down',
  },
  usage: { es: 'bot-secure down [--volumes] [--json]', en: 'bot-secure down [--volumes] [--json]' },
  async run(ctx) {
    const { log, t } = ctx;
    const { root, policy } = requireWorkspace(ctx);
    const opts = { log, t, dryRun: ctx.dryRun, volumes: !!ctx.flags.volumes };
    const out = { command: 'down', root, db: null, mocks: null };
    log.step(t('cli-core.downMocks'));
    try {
      out.mocks = await callModule(ctx, '../mocks/index.mjs', 'mocks', 'down', [root, policy, opts]);
    } catch (e) {
      log.warn(t('cli-core.moduleMissing', { module: 'mocks' }));
      log.info(t('cli-core.fixLine', { fix: e?.fix ?? 'bot-secure doctor' }));
      out.mocks = { ok: false };
    }
    log.step(t('cli-core.downDb'));
    try {
      out.db = await callModule(ctx, '../db/index.mjs', 'db', 'down', [root, policy, opts]);
    } catch (e) {
      log.warn(t('cli-core.dbFailed', { message: errText(ctx, e) }));
      log.info(t('cli-core.fixLine', { fix: e?.fix ?? 'bot-secure db status' }));
      out.db = { ok: false };
    }
    log.ok(t('cli-core.downDone'));
    log.data(out);
    return EXIT.OK;
  },
};
