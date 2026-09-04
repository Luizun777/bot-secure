// `bot-secure workspace <create|add|clone|status>`: crea el workspace de IA `<proyecto>-ai/`,
// registra apps (clon single-branch `ai-dev` o subcarpeta) y muestra el estado de cada una.
import { resolve } from 'node:path';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { findWorkspaceRoot } from '../lib/paths.mjs';
import { STACK_LABEL } from '../detect/index.mjs';
import { addApp, appMap, cloneWorkspace, createWorkspace, loadPolicyFile, status } from '../workspace/index.mjs';

/** Raíz del workspace o error con el comando exacto para crearlo. */
function requireRoot(ctx) {
  const root = findWorkspaceRoot(ctx.cwd);
  if (!root) throw new BotSecureError('workspace.noWorkspace', { fix: 'bot-secure workspace create mi-proyecto', exitCode: EXIT.ERROR });
  return root;
}

/** Imprime lo detectado en una app recién registrada (stack, comandos, ORM, SDKs). */
function printApp(ctx, app) {
  const { log, t } = ctx;
  log.info(t('detect.appSummary', {
    name: app.name, stack: STACK_LABEL[app.stack] ?? app.stack, kind: app.kind, packageManager: app.packageManager,
  }));
  if (app.port) log.dim(t('detect.appPort', { port: app.port }));
  if (app.runCmd || app.testCmd) log.dim(t('detect.appCommands', { run: app.runCmd ?? '-', test: app.testCmd ?? '-' }));
  if (app.orm) log.dim(t('detect.appOrm', { orm: app.orm, migrationsDir: app.migrationsDir ?? '-' }));
  if (app.sdks?.length) log.dim(t('detect.appSdks', { sdks: app.sdks.join(', ') }));
}

async function cmdCreate(ctx) {
  const { log, t } = ctx;
  const name = ctx.args[1];
  if (!name) throw new BotSecureError('workspace.needName', { fix: 'bot-secure workspace create mi-proyecto', exitCode: EXIT.ERROR });
  const dirName = /-ai$/.test(name) ? name : `${name}-ai`;
  if (ctx.dryRun) {
    const root = resolve(ctx.cwd, dirName);
    log.info(t('workspace.created', { root }));
    log.data({ dryRun: true, root });
    return EXIT.OK;
  }
  const root = await createWorkspace(name, { cwd: ctx.cwd });
  log.ok(t('workspace.created', { root }));
  log.info(t('workspace.nextAdd', { root }));
  log.data({ root });
  return EXIT.OK;
}

async function cmdAdd(ctx) {
  const { log, t } = ctx;
  const root = requireRoot(ctx);
  const source = ctx.args[1];
  if (!source) throw new BotSecureError('workspace.needSource', { fix: 'bot-secure workspace add git@servidor:equipo/api.git --kind backend', exitCode: EXIT.ERROR });
  if (ctx.dryRun) {
    log.info(t('workspace.addDryRun', { source, root }));
    log.data({ dryRun: true, source, root });
    return EXIT.OK;
  }
  const app = addApp(root, source, {
    kind: typeof ctx.flags.kind === 'string' ? ctx.flags.kind : undefined,
    name: typeof ctx.flags.name === 'string' ? ctx.flags.name : undefined,
    branch: typeof ctx.flags.branch === 'string' ? ctx.flags.branch : undefined,
    from: typeof ctx.flags.from === 'string' ? ctx.flags.from : undefined,
    push: !!ctx.flags.push,
  });
  log.ok(t('workspace.added', { name: app.name, path: app.path, branch: app.branch }));
  printApp(ctx, app);
  log.info(t('workspace.nextAfterAdd'));
  log.data({ app });
  return EXIT.OK;
}

async function cmdClone(ctx) {
  const { log, t } = ctx;
  const root = requireRoot(ctx);
  if (ctx.dryRun) {
    const policy = loadPolicyFile(root);
    log.info(t('workspace.cloneDryRun', { count: policy.apps.length }));
    log.data({ dryRun: true, apps: policy.apps.map((a) => a.name) });
    return EXIT.OK;
  }
  const results = cloneWorkspace(root);
  if (!results.length) { log.warn(t('workspace.cloneNone')); log.data({ results: [] }); return EXIT.OK; }
  for (const r of results) log.info(t('workspace.cloneLine', { app: r.app, action: t(`workspace.action_${r.action.replace('-', '')}`) }));
  log.ok(t('workspace.cloneDone', { count: results.filter((r) => r.action === 'cloned').length }));
  log.data({ results });
  return EXIT.OK;
}

async function cmdStatus(ctx) {
  const { log, t } = ctx;
  const root = requireRoot(ctx);
  const rows = status(root, { fetch: !!ctx.flags.fetch });
  if (!rows.length) {
    log.warn(t('workspace.statusEmpty'));
    log.info(t('workspace.nextAdd', { root }));
    log.data({ root, apps: [] });
    return EXIT.OK;
  }
  log.info(t('workspace.statusTitle', { root }));
  for (const r of rows) {
    if (r.missing) { log.warn(t('workspace.statusMissing', { app: r.app, path: r.path })); continue; }
    const marks = [];
    if (r.dirty) marks.push(t('workspace.statusDirty'));
    if (r.behind) marks.push(t('workspace.statusBehind', { behind: r.behind }));
    log.info(t(r.ok ? 'workspace.statusOk' : 'workspace.statusBad', {
      app: r.app, branch: r.branch ?? '?', marks: marks.length ? ` · ${marks.join(' · ')}` : '',
    }));
  }
  const bad = rows.filter((r) => r.missing || !r.ok);
  if (bad.length) log.info(t('workspace.statusFix', { app: bad[0].app }));
  log.info('\n' + appMap(loadPolicyFile(root), { lang: ctx.lang }));
  log.data({ root, apps: rows });
  return bad.length ? EXIT.FINDINGS : EXIT.OK;
}

export default {
  name: 'workspace',
  aliases: ['ws'],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Crea el workspace de IA (<proyecto>-ai/), registra apps y muestra su estado',
    en: 'Create the AI workspace (<project>-ai/), register apps and show their status',
  },
  usage: {
    es: 'bot-secure workspace <create <nombre> | add <remoto|carpeta> [--kind backend|frontend|mobile|lib] [--name n] [--from dev] [--push] | clone | status [--fetch]>',
    en: 'bot-secure workspace <create <name> | add <remote|folder> [--kind backend|frontend|mobile|lib] [--name n] [--from dev] [--push] | clone | status [--fetch]>',
  },
  async run(ctx) {
    const sub = ctx.args[0] ?? 'status';
    if (sub === 'create') return cmdCreate(ctx);
    if (sub === 'add') return cmdAdd(ctx);
    if (sub === 'clone') return cmdClone(ctx);
    if (sub === 'status') return cmdStatus(ctx);
    throw new BotSecureError('workspace.unknownSub', { vars: { sub }, fix: 'bot-secure workspace status', exitCode: EXIT.ERROR });
  },
};
