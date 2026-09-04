// `bot-secure start`: el comando para empezar. Detecta el contexto (carpeta vacía, repo git o
// workspace ya creado), pregunta lo mínimo con valores por defecto y encadena
// workspace → init → db init + db up → doctor --smoke. Ningún paso que falle detiene el resto:
// se dice el arreglo y se sigue con lo que se pueda.
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { EXIT } from '../lib/errors.mjs';
import { findGitRoot, findWorkspaceRoot } from '../lib/paths.mjs';
import { color } from '../lib/log.mjs';
import { detectApps } from '../detect/index.mjs';
import { detectContainerRuntime } from '../detect/index.mjs';
import { detectEngine, ENGINE_NAMES } from '../db/index.mjs';
import { defaultPolicy, savePolicy } from '../policy/index.mjs';
import { addApp, createWorkspace } from '../workspace/index.mjs';
import { createPrompter, normalizeApps, runInit } from './init.mjs';
import { collect, errText, exitFor, globalState, renderRows, renderSummary } from './doctor.mjs';

const IGNORED_ENTRIES = new Set(['.git', '.DS_Store', 'Thumbs.db']);

/** ¿La carpeta está vacía a efectos prácticos (sin contar .git ni basura del SO)? */
function looksEmpty(dir) {
  try { return readdirSync(dir).filter((f) => !IGNORED_ENTRIES.has(f)).length === 0; } catch { return true; }
}

/**
 * Contexto en el que se ejecutó `start`.
 * @returns {{kind:'workspace'|'repo'|'empty', root:string, project:string}}
 */
export function detectContext(cwd) {
  const ws = findWorkspaceRoot(cwd);
  if (ws) return { kind: 'workspace', root: ws, project: basename(ws).replace(/-ai$/, '') };
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) return { kind: 'repo', root: gitRoot, project: basename(gitRoot).replace(/-ai$/, ''), folderEmpty: false };
  // Sin repo git nunca se adopta la carpeta actual como raíz: se crea `<proyecto>-ai/` dentro.
  return { kind: 'empty', root: resolve(cwd), project: basename(resolve(cwd)), folderEmpty: looksEmpty(cwd) };
}

/** Perfil por defecto: en Windows nativo no hay aislamiento reforzado. */
function defaultProfile() {
  return process.platform === 'win32' ? 'standard' : 'sensitive';
}

/** Registra el repo (o carpeta) como app; nunca tumba el asistente. */
function addOne(ctx, root, source, kind) {
  const { log, t } = ctx;
  if (!source) return null;
  try {
    const app = addApp(root, source, { kind });
    log.info(`  ${t('cli-core.startAppAdded', { name: app.name, path: app.path, stack: app.stack })}`);
    return app;
  } catch (e) {
    log.warn(t('cli-core.startAppFailed', { source, message: errText(ctx, e) }));
    if (e?.fix) log.info(t('cli-core.fixLine', { fix: e.fix }));
    return null;
  }
}

/** Crea (o adopta) la raíz del workspace según el contexto detectado. */
async function ensureWorkspace(ctx, context, answers) {
  const { log, t } = ctx;
  if (context.kind === 'workspace') { log.info(t('cli-core.startContextWorkspace', { root: context.root })); return context.root; }
  log.step(t('cli-core.startStepWorkspace'));
  if (context.kind === 'repo') {
    // Monorepo o repo existente: la raíz del repo ES el workspace (el código no se mueve de sitio).
    const apps = detectApps(context.root);
    const policy = defaultPolicy({ project: answers.project });
    policy.profile = answers.profile;
    policy.db.engine = answers.engine;
    policy.apps = normalizeApps(apps, policy.branches.ai);
    savePolicy(context.root, policy);
    return context.root;
  }
  return createWorkspace(answers.project, { cwd: ctx.cwd, project: answers.project });
}

export default {
  name: 'start',
  aliases: [],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Asistente: detecta dónde estás, pregunta lo mínimo y lo prepara todo',
    en: 'Wizard: detects where you are, asks the minimum and gets everything ready',
  },
  usage: {
    es: 'bot-secure start [--yes] [--backend <repo>] [--frontend <repo>] [--engine postgres|mysql|…] [--profile sensitive|standard]',
    en: 'bot-secure start [--yes] [--backend <repo>] [--frontend <repo>] [--engine postgres|mysql|…] [--profile sensitive|standard]',
  },
  async run(ctx) {
    const { log, t, flags } = ctx;
    const context = detectContext(ctx.cwd);
    log.info(`${color.bold('bot-secure')} ${ctx.version} — ${t('cli-core.startTitle')}\n`);
    if (context.kind === 'empty') log.info(t('cli-core.startContextEmpty'));
    else if (context.kind === 'repo') log.info(t('cli-core.startContextGit', { root: context.root }));

    const p = createPrompter(ctx);
    if (!p.interactive) log.dim(t('cli-core.startNonInteractive'));
    const answers = { project: context.project, backend: '', frontend: '', engine: 'postgres', profile: defaultProfile() };
    try {
      if (context.kind !== 'workspace') {
        answers.project = await p.ask(t('cli-core.startAskProject'), context.project);
        answers.backend = typeof flags.backend === 'string' ? flags.backend : await p.ask(t('cli-core.startAskBackend'), '');
        answers.frontend = typeof flags.frontend === 'string' ? flags.frontend : await p.ask(t('cli-core.startAskFrontend'), '');
        const guessed = detectEngine(detectApps(context.root), { root: context.root }) ?? 'postgres';
        answers.engine = typeof flags.engine === 'string' ? flags.engine : await p.ask(t('cli-core.startAskDb'), guessed);
        answers.profile = typeof flags.profile === 'string' ? flags.profile : await p.ask(t('cli-core.startAskProfile'), defaultProfile());
      }
    } finally { p.close(); }
    if (!ENGINE_NAMES.includes(answers.engine)) answers.engine = 'postgres';
    if (process.platform === 'win32' && answers.profile === 'sensitive') log.warn(t('cli-core.startProfileWindows'));

    const steps = [];
    let root;
    try {
      root = await ensureWorkspace(ctx, context, answers);
    } catch (e) {
      log.error(t('cli-core.startStepFailed', { step: t('cli-core.startStepWorkspace'), message: errText(ctx, e) }));
      if (e?.fix) log.info(t('cli-core.fixLine', { fix: e.fix }));
      log.data({ command: 'start', ok: false, step: 'workspace' });
      return EXIT.ERROR;
    }
    steps.push({ step: 'workspace', ok: true, root });

    if (answers.backend || answers.frontend) {
      log.step(t('cli-core.startStepApps'));
      const added = [addOne(ctx, root, answers.backend, 'backend'), addOne(ctx, root, answers.frontend, 'frontend')].filter(Boolean);
      steps.push({ step: 'apps', ok: added.length === [answers.backend, answers.frontend].filter(Boolean).length, added: added.map((a) => a.name) });
    }

    // A partir de aquí `ctx` apunta al workspace: init, db y doctor trabajan sobre esa raíz.
    const inner = { ...ctx, cwd: root, yes: true, flags: { ...flags, yes: true, profile: answers.profile, engine: answers.engine } };
    log.step(t('cli-core.startStepInit'));
    try {
      await runInit(inner, { root });
      steps.push({ step: 'init', ok: true });
    } catch (e) {
      log.error(t('cli-core.startStepFailed', { step: t('cli-core.startStepInit'), message: errText(ctx, e) }));
      if (e?.fix) log.info(t('cli-core.fixLine', { fix: e.fix }));
      steps.push({ step: 'init', ok: false });
    }

    log.step(t('cli-core.startStepDb'));
    const runtime = detectContainerRuntime();
    if (!runtime.kind) {
      log.warn(t('cli-core.startNoRuntime'));
      log.info(t('cli-core.fixLine', { fix: 'https://podman.io' }));
      steps.push({ step: 'db', ok: false, reason: 'no-runtime' });
    } else {
      try {
        const db = await import('../db/index.mjs');
        const policy = (await import('../policy/index.mjs')).loadPolicy(root);
        const artifacts = db.generate(root, policy, { engine: answers.engine });
        db.writeArtifacts(root, artifacts, { onlyMissing: true });
        await db.up(root, policy, { log, t });
        steps.push({ step: 'db', ok: true });
      } catch (e) {
        log.warn(t('cli-core.dbFailed', { message: errText(ctx, e) }));
        log.info(t('cli-core.fixLine', { fix: e?.fix ?? 'bot-secure db up' }));
        steps.push({ step: 'db', ok: false });
      }
    }

    log.step(t('cli-core.startStepDoctor'));
    const { rows } = await collect(inner, { root, smoke: true });
    renderRows(inner, rows);
    renderSummary(inner, rows);
    const state = globalState(rows);
    steps.push({ step: 'doctor', ok: state === 'ok' || state === 'warn', state });

    // `start` siempre termina diciendo el siguiente paso: lo que quedó mal ya se dijo con su
    // arreglo, y el código de salida del diagnóstico lo da `bot-secure doctor`.
    log.info('');
    log.info(color.bold(t('cli-core.startDone')));  // el ✅ ya va en el mensaje (README)
    log.data({ command: 'start', root, project: answers.project, engine: answers.engine, profile: answers.profile, steps, state, doctorExitCode: exitFor(state) });
    return EXIT.OK;
  },
};
