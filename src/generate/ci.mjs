// Workflows de GitHub: gate en todo PR a dev, sincronización dev → ai-dev y retorno ai-dev → dev.
// El contenido vive en JS (lo desplegado es un bundle: no se leen plantillas del repo del bot).

/** @typedef {{path:string, content:string, mode?:string}} Artifact */

export const CI_DIR = '.github/workflows';

const HEAD = [
  '# Generado por bot-secure. Regenerar: bot-secure ci init',
  '# No lo edites a mano: `bot-secure doctor` marca drift contra lock.json.',
].join('\n');

/** Rama de IA y ramas protegidas efectivas. */
function branches(policy) {
  const ai = policy?.branches?.ai || 'ai-dev';
  const protectedList = policy?.branches?.protected?.length ? policy.branches.protected : ['dev', 'qa', 'prd'];
  const gates = protectedList.filter((b) => !b.includes('*'));
  return { ai, protected: protectedList, gates };
}

/** `bot-secure.yml`: el check obligatorio de todo PR. */
export function botSecureWorkflow(policy, { warn = false } = {}) {
  const { ai, gates } = branches(policy);
  const failOn = policy?.scan?.failOn || 'HIGH';
  // En modo `warn` el gate informa pero no tumba el PR (útil el primer mes).
  const cont = warn ? '\n        continue-on-error: true' : '';
  const pipelines = gates.join(', ');
  return [
    HEAD,
    'name: bot-secure',
    '',
    'on:',
    '  pull_request:',
    '    branches:',
    ...gates.map((b) => `      - ${b}`),
    '  push:',
    '    branches:',
    ...gates.map((b) => `      - ${b}`),
    '',
    'permissions:',
    '  contents: read',
    '',
    'concurrency:',
    '  group: bot-secure-${{ github.ref }}',
    '  cancel-in-progress: true',
    '',
    'jobs:',
    '  scan:',
    `    name: scan + doctor (${pipelines})`,
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '',
    '      - uses: actions/setup-node@v4',
    '        with:',
    "          node-version: '20'",
    '',
    '      - name: Instalar bot-secure',
    '        run: npm install -g bot-secure || npx --yes bot-secure --version',
    '',
    '      - name: Escaneo (secretos y PII)',
    '        env:',
    '          BOT_SECURE_CI: "1"',
    '          BOT_SECURE_HMAC_KEY: ${{ secrets.BOT_SECURE_HMAC_KEY }}',
    `        run: npx --yes bot-secure scan --ci --fail-on ${failOn} --json > bot-secure-report.json${cont}`,
    '',
    '      - name: Diagnóstico',
    '        run: npx --yes bot-secure doctor --json',
    '',
    '      # placeholder-leak: un placeholder o un fake en dev/qa/prd es un error de merge.',
    `      # En \`${ai}\` es lo normal, así que esta comprobación NO corre allí.`,
    '      - name: Fuga de placeholders del ambiente de IA',
    '        if: ${{ github.base_ref != \'' + ai + '\' && github.ref_name != \'' + ai + '\' }}',
    '        run: npx --yes bot-secure scan --ci --only placeholder-leak --fail-on MEDIUM',
    '',
    '      - name: Publicar el reporte (enmascarado)',
    '        if: always()',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: bot-secure-report',
    '          path: bot-secure-report.json',
    '          retention-days: 30',
    '',
  ].join('\n');
}

/** `ai-sync.yml`: cada push a dev actualiza la rama de IA (saneada). */
export function aiSyncWorkflow(policy) {
  const { ai } = branches(policy);
  const source = policy?.branches?.source || 'dev';
  return [
    HEAD,
    'name: ai-sync',
    '',
    'on:',
    '  push:',
    '    branches:',
    `      - ${source}`,
    '  workflow_dispatch:',
    '',
    'permissions:',
    '  contents: write',
    '',
    'concurrency:',
    '  group: ai-sync',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  sync:',
    `    name: ${source} → ${ai}`,
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '',
    '      - uses: actions/setup-node@v4',
    '        with:',
    "          node-version: '20'",
    '',
    '      - name: Sincronizar y sanear',
    '        env:',
    '          BOT_SECURE_CI: "1"',
    '          BOT_SECURE_HMAC_KEY: ${{ secrets.BOT_SECURE_HMAC_KEY }}',
    `        run: npx --yes bot-secure sync --from ${source} --to ${ai} --quarantine`,
    '',
    '      - name: Empujar la rama de IA',
    `        run: git push origin HEAD:${ai}`,
    '',
    '      - name: Avisar si algo quedó en cuarentena',
    '        if: hashFiles(\'QUARANTINE.md\') != \'\'',
    '        run: |',
    '          echo "::warning::Hay elementos en cuarentena; revisa QUARANTINE.md"',
    '          cat QUARANTINE.md',
    '',
  ].join('\n');
}

/** `ai-return.yml`: el trabajo hecho en ai-dev vuelve a dev por PR, nunca por push directo. */
export function aiReturnWorkflow(policy) {
  const { ai } = branches(policy);
  const target = policy?.branches?.source || 'dev';
  const prefix = policy?.branches?.taskPrefix || 'ai/';
  return [
    HEAD,
    'name: ai-return',
    '',
    'on:',
    '  push:',
    '    branches:',
    `      - '${prefix}**'`,
    '  workflow_dispatch:',
    '',
    'permissions:',
    '  contents: read',
    '  pull-requests: write',
    '',
    'jobs:',
    '  propose:',
    `    name: ${prefix}* → ${target} (PR)`,
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '',
    '      - uses: actions/setup-node@v4',
    '        with:',
    "          node-version: '20'",
    '',
    '      - name: Escaneo del rango antes de proponer el PR',
    '        env:',
    '          BOT_SECURE_CI: "1"',
    '          BOT_SECURE_HMAC_KEY: ${{ secrets.BOT_SECURE_HMAC_KEY }}',
    `        run: npx --yes bot-secure scan --ci --history --since origin/${ai} --fail-on HIGH`,
    '',
    '      - name: Abrir el PR',
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    '        run: |',
    `          gh pr create --base ${target} --head "$GITHUB_REF_NAME" \\`,
    '            --title "$GITHUB_REF_NAME" \\',
    '            --body "PR automático desde el ambiente de IA. El check \\`bot-secure\\` es obligatorio." \\',
    '            || echo "El PR ya existe"',
    '',
  ].join('\n');
}

/**
 * Workflows de CI del workspace.
 * Acepta las dos formas de llamada que existen en el CLI: `generateCi(policy)` y
 * `generateCi(root, policy, { provider, mode })`.
 * @returns {Artifact[]}
 */
export function generateCi(rootOrPolicy, maybePolicy, opts = {}) {
  const policy = typeof rootOrPolicy === 'string' ? (maybePolicy ?? {}) : (rootOrPolicy ?? {});
  const provider = opts.provider ?? 'github';
  if (provider !== 'github') return [];
  const warn = opts.mode === 'warn';
  const files = [
    { path: `${CI_DIR}/bot-secure.yml`, content: botSecureWorkflow(policy, { warn }) },
    { path: `${CI_DIR}/ai-sync.yml`, content: aiSyncWorkflow(policy) },
    { path: `${CI_DIR}/ai-return.yml`, content: aiReturnWorkflow(policy) },
  ];
  return files;
}
