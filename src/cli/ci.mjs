// `bot-secure ci github [--mode warn|block]`: escribe los workflows del gate obligatorio.
// La generación vive en src/generate/ci.mjs; este comando solo la invoca y explica el paso
// siguiente (marcar el check como obligatorio en la rama protegida).
import { chmodSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { writeGenerated } from '../lib/fsx.mjs';
import { findGitRoot, findWorkspaceRoot } from '../lib/paths.mjs';
import { readLock } from '../policy/lock.mjs';
import { generateCi } from '../generate/ci.mjs';
import { safePolicy } from './scan.mjs';

const PROVIDERS = ['github'];
const MODES = ['warn', 'block'];
const NEXT_VERSION = ['gitlab', 'azure', 'bitbucket'];
const posix = (p) => String(p).split(sep).join('/');

/** Escribe artefactos respetando ediciones humanas (usa los hashes de lock.json). */
export function writeArtifacts(root, artifacts, { dryRun = false, force = false } = {}) {
  const known = new Map((readLock(root)?.generated ?? []).map((g) => [posix(g.path), g.sha256]));
  const out = [];
  for (const a of artifacts) {
    const rel = posix(a.path);
    if (dryRun) { out.push({ path: rel, action: existsSync(join(root, a.path)) ? 'updated' : 'created' }); continue; }
    const abs = join(root, a.path);
    const r = writeGenerated(abs, a.content, { known: known.get(rel) ?? null, force });
    if (a.mode === '0755') { try { chmodSync(abs, 0o755); } catch { /* Windows: sin bits de ejecución */ } }
    out.push({ path: rel, action: r.action });
  }
  return out;
}

export default {
  name: 'ci',
  aliases: [],
  advanced: true,
  hidden: false,
  summary: {
    es: 'Genera los workflows del gate obligatorio (scan + doctor) para el proveedor de CI',
    en: 'Generate the required-gate workflows (scan + doctor) for the CI provider',
  },
  usage: {
    es: 'bot-secure ci github [--mode warn|block] [--force] [--json] [--dry-run]',
    en: 'bot-secure ci github [--mode warn|block] [--force] [--json] [--dry-run]',
  },
  async run(ctx) {
    const { log, t } = ctx;
    const provider = ctx.args[0] ?? 'github';
    if (NEXT_VERSION.includes(provider)) {
      throw new BotSecureError('cli-tools.ciNextVersion', { vars: { provider }, fix: 'bot-secure ci github', exitCode: EXIT.ERROR });
    }
    if (!PROVIDERS.includes(provider)) {
      throw new BotSecureError('cli-tools.ciUnknownProvider', { vars: { provider, providers: PROVIDERS.join('|') }, fix: 'bot-secure ci github', exitCode: EXIT.ERROR });
    }
    const mode = typeof ctx.flags.mode === 'string' ? ctx.flags.mode : 'block';
    if (!MODES.includes(mode)) {
      throw new BotSecureError('cli-tools.ciUnknownMode', { vars: { mode, modes: MODES.join('|') }, fix: 'bot-secure ci github --mode block', exitCode: EXIT.ERROR });
    }
    const root = findWorkspaceRoot(ctx.cwd) ?? findGitRoot(ctx.cwd);
    if (!root) throw new BotSecureError('cli-tools.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
    const policy = safePolicy(root);

    const artifacts = generateCi(root, policy, { provider, mode, apps: policy.apps ?? [] });
    const results = writeArtifacts(root, artifacts ?? [], { dryRun: ctx.dryRun, force: !!ctx.flags.force });
    log.ok(t('cli-tools.ciDone', { count: results.length, provider, mode }));
    for (const r of results) log.info(t('cli-tools.artifact', { action: r.action, path: r.path }));
    if (ctx.dryRun) log.info(t('cli-tools.dryRun'));
    log.info(t('cli-tools.ciRequiredCheck', { branch: policy.branches?.protected?.[0] ?? 'dev' }));
    log.info(t('cli-tools.ciRequiredCheckHow'));
    log.data({ command: 'ci', provider, mode, artifacts: results, dryRun: !!ctx.dryRun });
    return EXIT.OK;
  },
};
