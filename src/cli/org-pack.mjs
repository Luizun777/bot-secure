// `bot-secure org-pack`: paquete para el equipo de Seguridad (infosec/): managed-settings.json,
// rulesets + apply.sh, CODEOWNERS, guía MDM, checklist de contrato y tabla enforced vs best-effort.
// La generación vive en src/generate/orgpack.mjs; este comando la invoca y da el siguiente paso.
import { EXIT, BotSecureError } from '../lib/errors.mjs';
import { findGitRoot, findWorkspaceRoot } from '../lib/paths.mjs';
import { generateOrgPack } from '../generate/orgpack.mjs';
import { writeArtifacts } from './ci.mjs';
import { safePolicy } from './scan.mjs';

export default {
  name: 'org-pack',
  aliases: ['orgpack'],
  advanced: true,
  hidden: false,
  summary: {
    es: 'Genera infosec/: managed settings, protección de ramas, CODEOWNERS y checklist',
    en: 'Generate infosec/: managed settings, branch protection, CODEOWNERS and checklist',
  },
  usage: {
    es: 'bot-secure org-pack [--force] [--json] [--dry-run]',
    en: 'bot-secure org-pack [--force] [--json] [--dry-run]',
  },
  async run(ctx) {
    const { log, t } = ctx;
    const root = findWorkspaceRoot(ctx.cwd) ?? findGitRoot(ctx.cwd);
    if (!root) throw new BotSecureError('cli-tools.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
    const policy = safePolicy(root);

    const artifacts = generateOrgPack(root, policy, { apps: policy.apps ?? [] });
    const results = writeArtifacts(root, artifacts ?? [], { dryRun: ctx.dryRun, force: !!ctx.flags.force });
    log.ok(t('cli-tools.orgpackDone', { count: results.length }));
    for (const r of results) log.info(t('cli-tools.artifact', { action: r.action, path: r.path }));
    if (ctx.dryRun) log.info(t('cli-tools.dryRun'));
    const infosec = policy.owners?.infosec;
    log.info(infosec ? t('cli-tools.orgpackNextOwner', { owner: infosec }) : t('cli-tools.orgpackNext'));
    log.data({ command: 'org-pack', artifacts: results, infosec: infosec ?? null, dryRun: !!ctx.dryRun });
    return EXIT.OK;
  },
};
