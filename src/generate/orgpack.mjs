// Paquete de organización (`infosec/`): lo que Seguridad de la Información necesita para aprobar
// el uso de Claude Code. Fuente: docs/infosec.md del propio bot.
import { allowedDomains } from '../policy/compile.mjs';

/** @typedef {{path:string, content:string, mode?:string}} Artifact */

export const ORG_DIR = 'infosec';

/** Versión mínima de Claude Code que exige el bot (misma que lock.json). */
export const CLAUDE_CODE_MIN = '2.1.246';

/**
 * `managed-settings.json`: ajustes que un administrador despliega por MDM.
 * Es el ÚNICO control local que el desarrollador no puede desactivar.
 * @param {object} policy
 * @returns {object}
 */
export function managedSettings(policy) {
  const domains = safeDomains(policy);
  const sensitive = policy?.profile === 'sensitive';
  return {
    $comment: 'bot-secure org-pack. Despliegue: /Library/Application Support/ClaudeCode/ (macOS), /etc/claude-code/ (Linux), C:\\Program Files\\ClaudeCode\\ (Windows).',
    disableBypassPermissionsMode: 'disable',
    allowManagedHooksOnly: true,
    allowManagedPermissionRulesOnly: sensitive,
    allowedMcpServers: policy?.mcp?.allowed ?? [],
    permissions: {
      defaultMode: 'default',
      deny: [
        'WebFetch',
        'WebSearch',
        'Read(./.env)',
        'Read(./**/.env)',
        'Read(~/.aws/**)',
        'Read(~/.ssh/**)',
        'Read(~/.claude/**)',
        'Bash(curl:*)',
        'Bash(wget:*)',
        'Bash(nc:*)',
        'Bash(ssh:*)',
        'Bash(scp:*)',
      ],
    },
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: sensitive,
      network: { allowedDomains: domains },
    },
    env: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_FEEDBACK_COMMAND: '1',
      CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    },
    autoMemoryEnabled: false,
    cleanupPeriodDays: 7,
    minimumVersion: CLAUDE_CODE_MIN,
  };
}

/** Dominios permitidos; si `policy/compile` no está disponible, la lista mínima. */
function safeDomains(policy) {
  try {
    const d = allowedDomains(policy);
    if (Array.isArray(d) && d.length) return d;
  } catch { /* política incompleta: lista mínima */ }
  return ['api.anthropic.com', 'localhost', '127.0.0.1'];
}

/** `rulesets.json`: protección de ramas de GitHub (la aplica un administrador). */
export function rulesets(policy) {
  const ai = policy?.branches?.ai || 'ai-dev';
  const gates = (policy?.branches?.protected ?? ['dev', 'qa', 'prd']).filter((b) => !b.includes('*'));
  const base = (name, includes, checks) => ({
    name,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: includes.map((b) => `refs/heads/${b}`), exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'pull_request', parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_code_owner_review: true, required_review_thread_resolution: true } },
      ...(checks ? [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'bot-secure' }] } }] : []),
    ],
  });
  return JSON.stringify([
    base('bot-secure: ramas productivas', gates, true),
    {
      name: `bot-secure: ${ai} solo la escribe CI`,
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: [`refs/heads/${ai}`], exclude: [] } },
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
      bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' }],
    },
  ], null, 2) + '\n';
}

/** `apply.sh`: aplica los rulesets con `gh api`. Lo ejecuta un administrador del repo. */
export function applySh(policy) {
  const repo = policy?.repo || '<owner>/<repo>';
  return [
    '#!/bin/sh',
    '# bot-secure org-pack: aplica la protección de ramas. Requiere `gh` autenticado como ADMIN del repo.',
    '# Uso: sh infosec/apply.sh [owner/repo]',
    'set -eu',
    '',
    `REPO="\${1:-${repo}}"`,
    '',
    'if ! command -v gh >/dev/null 2>&1; then',
    '  echo "Falta gh (GitHub CLI). Arreglo: brew install gh && gh auth login" >&2',
    '  exit 2',
    'fi',
    '',
    'if ! command -v jq >/dev/null 2>&1; then',
    '  echo "Falta jq. Arreglo: brew install jq" >&2',
    '  exit 2',
    'fi',
    '',
    'DIR=$(dirname "$0")',
    '',
    'jq -c \'.[]\' "$DIR/rulesets.json" | while read -r rule; do',
    '  NAME=$(printf \'%s\' "$rule" | jq -r .name)',
    '  echo "Aplicando: $NAME"',
    '  printf \'%s\' "$rule" | gh api --method POST "repos/$REPO/rulesets" --input - >/dev/null \\',
    '    || echo "  (ya existía o falta permiso de admin)"',
    'done',
    '',
    'echo "Listo. Comprueba en: https://github.com/$REPO/settings/rules"',
    '',
  ].join('\n');
}

/**
 * `CODEOWNERS` de referencia para InfoSec. El workspace ya recibe uno de `generate/readme.mjs`:
 * este se deja en `infosec/` como copia para repos de app que no lo tengan.
 */
export function codeowners(policy) {
  const infosec = policy?.owners?.infosec || '@infosec';
  return [
    '# bot-secure: lo que cambia las guardas necesita revisión de Seguridad de la Información.',
    `.claude/**            ${infosec}`,
    `.githooks/**          ${infosec}`,
    `.bot-secure/**        ${infosec}`,
    `.env.ai               ${infosec}`,
    `docs/SECURITY.md      ${infosec}`,
    `infosec/**            ${infosec}`,
    `.github/workflows/**  ${infosec}`,
    '',
  ].join('\n');
}

/** `checklist-contrato.md`: qué pedir al contratar. */
export function checklistContrato(policy) {
  const owner = policy?.owners?.repoOwner || '(sin asignar)';
  return [
    '# Checklist de contratación (Claude Code)',
    '',
    '> Orden de prioridad. La línea 1 resuelve el riesgo #1.',
    '',
    '## 1. Plan comercial (lo primero)',
    '',
    '- [ ] Migrar de cuentas Free/Pro/Max personales a **Claude Team o Enterprise**, o usar la **API** (directa, Bedrock o Vertex).',
    '- [ ] Motivo: con cuenta personal y "Help improve Claude" activo, Anthropic **puede entrenar** con el contenido y **retenerlo 5 años**; no aplican términos comerciales ni DPA.',
    '',
    '## 2. Contrato y datos',
    '',
    '- [ ] DPA firmado (tratamiento de datos personales).',
    '- [ ] Confirmar la retención aplicable al plan contratado y dejarla por escrito.',
    '- [ ] ZDR (Zero Data Retention) si el caso de uso lo exige.',
    '- [ ] Transferencia internacional documentada (LFPDPPP, México): con datos sintéticos en `ai-dev` no hay tratamiento de datos reales.',
    '',
    '## 3. Administración',
    '',
    '- [ ] Consola de administración con SSO/SCIM.',
    '- [ ] `managed-settings.json` desplegado por MDM (Jamf/Intune) o en la ruta del sistema.',
    `- [ ] Versión mínima de Claude Code fijada: \`${CLAUDE_CODE_MIN}\`.`,
    '- [ ] GitHub Team o superior (los rulesets sobre repos privados lo requieren).',
    '',
    '## 4. Responsables',
    '',
    `- Dueño del repo: ${owner}`,
    `- Seguridad de la Información: ${policy?.owners?.infosec || '(sin asignar)'}`,
    `- Plataforma: ${policy?.owners?.platform || '(sin asignar)'}`,
    '',
    '## 5. Fuera de alcance',
    '',
    '- [ ] Otras herramientas de IA (Cursor, Copilot, chat web) requieren política corporativa aparte: bot-secure no las cubre.',
    '',
  ].join('\n');
}

/** `enforced-vs-best-effort.md`: qué está garantizado y qué no, con el estado real del repo. */
export function enforcedVsBestEffort(policy) {
  const sensitive = policy?.profile === 'sensitive';
  const level = policy?.level ?? 1;
  return [
    '# Controles: qué está garantizado y qué no',
    '',
    `Perfil: **${policy?.profile || 'standard'}** · nivel de contención: **${level}** · modo del guard: **${policy?.guard?.mode || 'block'}**.`,
    '',
    '| Control | Tipo | Quién lo hace cumplir |',
    '|---|---|---|',
    '| Check `bot-secure` obligatorio en todo PR a `dev` | **enforced** | GitHub (rulesets) |',
    '| `dev`, `qa`, `prd` solo por PR, sin force push | **enforced** | GitHub |',
    '| `CODEOWNERS` de InfoSec sobre `.claude/**`, `.githooks/**`, `.bot-secure/**` | **enforced** (GitHub Team+) | GitHub |',
    '| Reglas `deny`, hooks, sandbox nativo | best-effort | Máquina del dev (puede editarlas) |',
    '| Managed settings de Claude Code | **enforced** si hay MDM o plan Team/Enterprise | IT |',
    '| Clon single-branch / espejo sin historia contaminada | best-effort (verificado en cada sesión) | Máquina del dev |',
    '',
    '**Sin plan Team/Enterprise ni MDM, todo lo local es best-effort.** `bot-secure doctor` lo detecta y lo dice.',
    '',
    '## Estado de este repositorio',
    '',
    `- \`requireOrgAccount\`: ${policy?.requireOrgAccount ? '**sí** (una cuenta personal bloquea la sesión)' : 'no (solo aviso en `doctor`)'}.`,
    `- Sandbox obligatorio: ${sensitive ? '**sí** (perfil `sensitive`: si el sandbox no está disponible, la sesión no arranca)' : 'no (aviso en la statusline)'}.`,
    `- Rama de IA: \`${policy?.branches?.ai || 'ai-dev'}\`; ramas protegidas: ${(policy?.branches?.protected ?? []).map((b) => `\`${b}\``).join(', ') || '(sin definir)'}.`,
    '',
    '## Límites que debes conocer',
    '',
    '- Un escáner por patrones nunca es completo; cada reporte lo dice.',
    '- El allowlist de dominios es defensa en profundidad, no frontera (domain fronting).',
    '- Todo archivo que Claude lee viaja a la API y queda en `~/.claude/projects/**` en texto plano: ningún contenedor cambia eso.',
    '',
  ].join('\n');
}

/**
 * Paquete de organización completo.
 * Acepta `generateOrgPack(policy)` y `generateOrgPack(root, policy, { apps })` (forma del CLI).
 * @returns {Artifact[]}
 */
export function generateOrgPack(rootOrPolicy, maybePolicy) {
  const policy = typeof rootOrPolicy === 'string' ? (maybePolicy ?? {}) : (rootOrPolicy ?? {});
  return [
    { path: `${ORG_DIR}/managed-settings.json`, content: JSON.stringify(managedSettings(policy), null, 2) + '\n' },
    { path: `${ORG_DIR}/rulesets.json`, content: rulesets(policy) },
    { path: `${ORG_DIR}/apply.sh`, content: applySh(policy), mode: '0755' },
    { path: `${ORG_DIR}/checklist-contrato.md`, content: checklistContrato(policy) },
    { path: `${ORG_DIR}/enforced-vs-best-effort.md`, content: enforcedVsBestEffort(policy) },
    { path: `${ORG_DIR}/CODEOWNERS.ejemplo`, content: codeowners(policy) },
  ];
}
