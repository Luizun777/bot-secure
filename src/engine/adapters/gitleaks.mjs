// Adaptador de gitleaks: SOLO como localizador de candidatos. Nunca se usa su fingerprint ni su
// severidad; el valor jamás sale de gitleaks (siempre `--redact`). El motor nativo reescanea la
// línea localizada y calcula el fingerprint canónico (HMAC), para que el baseline sea uno solo.
import { run, which } from '../../lib/exec.mjs';

/** Mapa regla de gitleaks → ruleId nativo. Versionado: cambia con RULES_VERSION. */
export const RULE_MAP = Object.freeze({
  'aws-access-token': 'aws-access-key-id',
  'aws-secret-key': 'aws-secret-access-key',
  'github-pat': 'github-token',
  'github-oauth': 'github-token',
  'github-app-token': 'github-token',
  'github-refresh-token': 'github-token',
  'github-fine-grained-pat': 'github-fine-grained-pat',
  'gitlab-pat': 'gitlab-pat',
  'gitlab-deploy-token': 'gitlab-pat',
  'npm-access-token': 'npm-token',
  'slack-bot-token': 'slack-token',
  'slack-user-token': 'slack-token',
  'slack-app-token': 'slack-token',
  'slack-config-access-token': 'slack-token',
  'slack-webhook-url': 'slack-webhook',
  'gcp-api-key': 'google-api-key',
  'gcp-service-account': 'gcp-service-account-key',
  'google-oauth-client-secret': 'google-oauth-client-secret',
  'stripe-access-token': 'stripe-live-key',
  'twilio-api-key': 'twilio-api-key',
  'sendgrid-api-token': 'sendgrid-api-key',
  'mailgun-private-api-token': 'mailgun-api-key',
  'openai-api-key': 'openai-api-key',
  'anthropic-api-key': 'anthropic-api-key',
  'telegram-bot-api-token': 'telegram-bot-token',
  'discord-api-token': 'discord-webhook',
  jwt: 'jwt',
  'jwt-base64': 'jwt',
  'private-key': 'private-key-pem',
  'generic-api-key': 'generic-api-key',
  'digitalocean-pat': 'digitalocean-token',
  'huggingface-access-token': 'huggingface-token',
  'shopify-access-token': 'shopify-token',
  'square-access-token': 'square-token',
  'databricks-api-token': 'databricks-token',
  'hashicorp-vault-service-token': 'vault-service-token',
  'pypi-upload-token': 'pypi-token',
  'sentry-access-token': 'sentry-dsn',
  'cloudinary-api-key': 'cloudinary-url',
  'azure-storage-account-key': 'azure-storage-account-key',
  'kubernetes-secret-yaml': 'k8s-secret-data',
});

/** @returns {{ok:boolean, bin?:string, version?:string}} ¿gitleaks está disponible? */
export function available() {
  const bin = which('gitleaks');
  if (!bin) return { ok: false };
  const r = run('gitleaks', ['version']);
  return { ok: r.status === 0, bin, version: r.stdout.trim() || undefined };
}

/** Traduce una regla de gitleaks al ruleId nativo (null si no hay equivalente). */
export function nativeRuleId(gitleaksRuleId) {
  return RULE_MAP[String(gitleaksRuleId)] ?? null;
}

/**
 * Localiza candidatos con gitleaks (siempre `--redact`, sin verificación de red).
 * @param {string} root
 * @param {{history?:boolean, timeout?:number}} [opts]
 * @returns {{ok:boolean, reason?:string, candidates:{commit:string|null, file:string, line:number,
 *   gitleaksRuleId:string, ruleId:string|null, source:'gitleaks'}[]}}
 */
export function candidates(root, { history = false, timeout = 300_000 } = {}) {
  const av = available();
  if (!av.ok) return { ok: false, reason: 'missing', candidates: [] };
  const args = history
    ? ['git', '--no-banner', '--redact=100', '--report-format=json', '--report-path=-', '--exit-code=0', root]
    : ['dir', '--no-banner', '--redact=100', '--report-format=json', '--report-path=-', '--exit-code=0', root];
  const r = run('gitleaks', args, { cwd: root, timeout });
  if (r.status !== 0 && !r.stdout.trim()) return { ok: false, reason: r.stderr.trim().slice(0, 300) || 'failed', candidates: [] };
  let parsed;
  try { parsed = JSON.parse(r.stdout || '[]'); } catch { return { ok: false, reason: 'bad-json', candidates: [] }; }
  const list = Array.isArray(parsed) ? parsed : [];
  return {
    ok: true,
    candidates: list.map((c) => ({
      commit: c.Commit || null,
      file: String(c.File ?? '').replace(/\\/g, '/'),
      line: Number(c.StartLine ?? 1) || 1,
      gitleaksRuleId: String(c.RuleID ?? ''),
      ruleId: nativeRuleId(c.RuleID),
      source: 'gitleaks',
    })),
  };
}
