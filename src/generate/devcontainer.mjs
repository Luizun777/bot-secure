// Devcontainer de NIVEL 2 (opcional y endurecido). No cambia lo que viaja a la API:
// solo acota el radio de daño de un comando o un paquete no auditado.
import { CLAUDE_CODE_MIN } from './orgpack.mjs';

/** @typedef {{path:string, content:string, mode?:string}} Artifact */

export const DEVCONTAINER_DIR = '.devcontainer';

/**
 * Imagen base. El digest NO se inventa: se toma de `policy.devcontainer.baseDigest` si el
 * equipo ya lo fijó, y si no se deja la instrucción exacta para fijarlo (un digest falso
 * rompería el build y daría una falsa sensación de reproducibilidad).
 */
export const BASE_IMAGE = 'mcr.microsoft.com/devcontainers/base:ubuntu-22.04';

/** devcontainer.json endurecido. */
export function devcontainerJson(policy) {
  const project = policy?.project || 'app';
  return {
    $comment: 'bot-secure nivel 2. Endurecido: el socket del demonio de Docker NO se monta, capacidades mínimas, DNS interno, salida solo a la allowlist.',
    name: `${project}-ai`,
    build: { dockerfile: 'Dockerfile' },
    runArgs: [
      '--cap-drop=ALL',
      '--cap-add=NET_ADMIN',
      '--security-opt', 'no-new-privileges:true',
      '--dns', '127.0.0.11',
      '--network', `${project}-ai-internal`,
    ],
    // ~/.claude por proyecto: el historial de una sesión no se mezcla con el de otro repo.
    mounts: [
      'source=${localWorkspaceFolderBasename}-claude,target=/home/vscode/.claude,type=volume',
      'source=${localWorkspaceFolderBasename}-history,target=/commandhistory,type=volume',
    ],
    containerEnv: {
      AI_ENV: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_FEEDBACK_COMMAND: '1',
      CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
    },
    remoteUser: 'vscode',
    updateRemoteUserUID: true,
    postCreateCommand: 'sh .devcontainer/init-firewall.sh',
    customizations: { vscode: { extensions: [] } },
    features: {},
    // A propósito no se monta el socket del demonio: montarlo equivale a dar root del host.
    overrideCommand: false,
  };
}

/** Dockerfile con la versión de Claude Code fijada y la imagen base por digest. */
export function dockerfile(policy) {
  const digest = policy?.devcontainer?.baseDigest || '';
  return [
    '# bot-secure nivel 2. La imagen base va por DIGEST para que no se mueva entre builds.',
    ...(digest ? [] : [
      '# Falta fijar el digest. Obténlo y sustituye la línea FROM:',
      `#   docker buildx imagetools inspect ${BASE_IMAGE} --format '{{.Manifest.Digest}}'`,
      '#   bot-secure policy set devcontainer.baseDigest sha256:<digest>',
    ]),
    digest ? `FROM ${BASE_IMAGE}@${digest}` : `FROM ${BASE_IMAGE}`,
    '',
    '# La versión de Claude Code va FIJA: una actualización silenciosa cambiaría las guardas.',
    `ENV CLAUDE_CODE_VERSION=${CLAUDE_CODE_MIN}`,
    '',
    'RUN apt-get update \\',
    ' && apt-get install -y --no-install-recommends ca-certificates curl git iptables ipset jq \\',
    ' && rm -rf /var/lib/apt/lists/*',
    '',
    'USER vscode',
    'RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}',
    '',
    '# El firewall se aplica en postCreate (necesita NET_ADMIN).',
    'COPY init-firewall.sh /usr/local/bin/init-firewall.sh',
    '',
  ].join('\n');
}

/** Firewall de salida: allowlist explícita, sin github.com. */
export function initFirewall(policy) {
  const domains = ['api.anthropic.com', ...(policy?.network?.registries ?? []), ...(policy?.network?.allowedDomains ?? [])];
  const uniq = [...new Set(domains)];
  return [
    '#!/bin/sh',
    '# bot-secure nivel 2: solo sale tráfico a la allowlist de abajo.',
    '# El devcontainer de referencia permite además el sitio de GitHub; aquí NO, porque un push',
    '# a un repo propio es una vía de exfiltración tan buena como cualquier otra.',
    'set -eu',
    '',
    'if ! command -v iptables >/dev/null 2>&1; then',
    '  echo "Sin iptables: el firewall del contenedor NO se aplicó (best-effort)." >&2',
    '  exit 0',
    'fi',
    '',
    'iptables -F OUTPUT || true',
    'iptables -P OUTPUT DROP',
    'iptables -A OUTPUT -o lo -j ACCEPT',
    'iptables -A OUTPUT -d 127.0.0.11 -p udp --dport 53 -j ACCEPT   # DNS interno de Docker',
    'iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT',
    '',
    '# Red interna del workspace (BD y mocks).',
    'iptables -A OUTPUT -d 172.16.0.0/12 -j ACCEPT',
    '',
    'for HOST in \\',
    ...uniq.map((d) => `  ${d} \\`),
    '  ; do',
    '  for IP in $(getent ahostsv4 "$HOST" | awk \'{print $1}\' | sort -u); do',
    '    iptables -A OUTPUT -d "$IP" -p tcp --dport 443 -j ACCEPT',
    '  done',
    'done',
    '',
    'echo "Firewall aplicado. Dominios permitidos: ' + uniq.join(', ') + '"',
    '',
  ].join('\n');
}

const README = [
  '# Devcontainer de nivel 2 (opcional)',
  '',
  'Docker **no** es requisito de bot-secure ni cambia lo que viaja a la API de Anthropic.',
  'Este contenedor acota el radio de daño en cuatro casos concretos:',
  '',
  '1. `--dangerously-skip-permissions`.',
  '2. MCP o paquetes de terceros no auditados.',
  '3. Toolchain reproducible entre máquinas.',
  '4. Windows sin WSL2 (donde no hay sandbox nativo).',
  '',
  '## Qué está endurecido frente al devcontainer de referencia',
  '',
  '| Ajuste | Aquí |',
  '|---|---|',
  '| Imagen | fijada por digest (`policy.devcontainer.baseDigest`) |',
  '| Capacidades | `cap-drop ALL` + solo `NET_ADMIN` (para el firewall) |',
  '| `no-new-privileges` | sí |',
  '| `docker.sock` | **no se monta** (montarlo equivale a dar root del host) |',
  '| DNS | solo `127.0.0.11` (DNS interno de Docker) |',
  '| Salida a GitHub | **no permitida** (un push a un repo propio exfiltra igual) |',
  '| `~/.claude` | volumen por proyecto, no compartido |',
  '| Versión de Claude Code | fijada |',
  '',
  '## Licencia',
  '',
  'Docker Desktop es de pago para empresas de 250+ empleados o 10 M USD de ingresos.',
  'Colima, Podman o Rancher Desktop sirven igual y no tienen esa restricción.',
  '',
].join('\n');

/**
 * Artefactos del devcontainer (solo tiene sentido en nivel ≥ 2).
 * @param {object} policy
 * @returns {Artifact[]}
 */
export function generateDevcontainer(policy) {
  return [
    { path: `${DEVCONTAINER_DIR}/devcontainer.json`, content: JSON.stringify(devcontainerJson(policy), null, 2) + '\n' },
    { path: `${DEVCONTAINER_DIR}/Dockerfile`, content: dockerfile(policy) },
    { path: `${DEVCONTAINER_DIR}/init-firewall.sh`, content: initFirewall(policy), mode: '0755' },
    { path: `${DEVCONTAINER_DIR}/README.md`, content: README },
  ];
}
