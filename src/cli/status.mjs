// `bot-secure status`: el resumen de `doctor` en una pantalla (ramas de las apps, base de datos,
// aislamiento y cuenta). Para el detalle con el arreglo de cada fila está `bot-secure doctor`.
import { EXIT } from '../lib/errors.mjs';
import { color } from '../lib/log.mjs';
import { collect, exitFor, globalState } from './doctor.mjs';

const MARK = { ok: color.ok('•'), warn: color.warn('•'), error: color.err('•') };

/** Filas de un grupo, o una línea de "sin datos". */
function group(ctx, title, rows, empty = null) {
  const { log } = ctx;
  log.info(color.bold(title));
  if (!rows.length) { if (empty) log.dim(`  ${empty}`); return; }
  for (const r of rows) log.info(`  ${MARK[r.state]} ${r.message}`);
}

export default {
  name: 'status',
  aliases: ['st'],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Resumen en una pantalla: apps, base de datos, aislamiento y cuenta',
    en: 'One-screen summary: apps, database, isolation and account',
  },
  usage: { es: 'bot-secure status [--json]', en: 'bot-secure status [--json]' },
  async run(ctx) {
    const { log, t } = ctx;
    const { rows, root, policy } = await collect(ctx, { smoke: false });
    const pick = (fn) => rows.filter(fn);
    const apps = pick((r) => r.id.startsWith('app:'));
    const isolation = pick((r) => ['integrity', 'lock', 'sandbox', 'policy', 'shell'].includes(r.id) || r.id.startsWith('env'));
    const db = pick((r) => r.id === 'db');
    const account = pick((r) => r.id === 'account' || r.id === 'claude');

    log.info(color.bold(t('cli-core.statusTitle', { project: policy?.project ?? '—' })));
    log.dim(root ?? t('cli-core.workspaceMissing'));
    log.info('');
    group(ctx, t('cli-core.statusApps'), apps, t('cli-core.statusNoApps'));
    group(ctx, t('cli-core.statusDb'), db);
    group(ctx, t('cli-core.statusIsolation'), isolation);
    group(ctx, t('cli-core.statusAccount'), account);

    const bad = rows.filter((r) => r.state !== 'ok');
    log.info('');
    if (!bad.length) log.ok(t('cli-core.statusAllOk'));
    else log.info(t('cli-core.statusProblems', { count: bad.length }));
    const state = globalState(rows);
    log.data({ command: 'status', root, project: policy?.project ?? null, state, exitCode: exitFor(state), rows });
    return exitFor(state) === EXIT.DRIFT ? EXIT.DRIFT : (state === 'error' ? EXIT.ERROR : EXIT.OK);
  },
};
