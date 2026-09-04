// README.md del workspace y .github/{PULL_REQUEST_TEMPLATE.md,CODEOWNERS}.
import { artifact, normalize, renderTemplate } from './md-helpers.mjs';

/** Rutas que protege InfoSec en CODEOWNERS. */
export const PROTECTED_PATHS = ['/.claude/', '/.githooks/', '/.bot-secure/', '/.env.ai', '/docs/SECURITY.md', '/.github/CODEOWNERS'];

/** @returns {import('./md-helpers.mjs').Artifact[]} */
export function generateReadme(view) {
  return [artifact(['README.md'], renderTemplate('md', 'README-workspace.md', view))];
}

/** PR template + CODEOWNERS (si no hay owners.infosec, las líneas van comentadas con instrucción). */
export function generateGithub(view) {
  const pr = artifact(['.github', 'PULL_REQUEST_TEMPLATE.md'], renderTemplate('md', 'PULL_REQUEST_TEMPLATE.md', view));
  const owner = view.owners.infosec;
  const lines = ['# CODEOWNERS del workspace de IA (generado por bot-secure).',
    '# Las rutas protegidas requieren aprobación del equipo de InfoSec antes de fusionar.'];
  if (!owner) lines.push('# Falta owners.infosec en .bot-secure/policy.json: descomenta y sustituye @org/infosec (bot-secure policy set owners.infosec @org/infosec).');
  for (const p of PROTECTED_PATHS) lines.push(owner ? `${p} ${owner}` : `# ${p} @org/infosec`);
  if (view.owners.repoOwner) lines.push('', '# Resto del workspace', `* ${view.owners.repoOwner}`);
  return [pr, artifact(['.github', 'CODEOWNERS'], normalize(lines.join('\n')))];
}
