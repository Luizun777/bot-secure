// compose.ai.yml de la raíz: amarra BD ↔ mocks ↔ (opcional) apps con Dockerfile.
// Reglas duras: todos los puertos publicados van a 127.0.0.1 y la red `ai-internal` es interna.
import { toYaml } from '../db/compose.mjs';
import { MOCK_PORTS, slug } from './fakes.mjs';
import { MOCK_IMAGES, mocksNeeded } from './mocks.mjs';

export const COMPOSE_FILE = 'compose.ai.yml';
export const DB_COMPOSE = 'mocks/db/compose.db.yml';

/** Publica un puerto SOLO en el loopback. */
const local = (host, container = host) => `127.0.0.1:${host}:${container}`;

/** Nombre de la red interna del workspace. */
export const networkName = (policy) => `${slug(policy?.project || 'app')}-ai-internal`;

/**
 * Objeto compose del workspace (sin la BD: esa vive en mocks/db/compose.db.yml y se incluye).
 * @param {object} policy
 * @param {object[]} apps
 * @returns {object}
 */
export function composeAiObject(policy, apps = []) {
  const need = mocksNeeded(policy, apps);
  const project = slug(policy?.project || 'app');
  const services = {};

  if (need.idp) {
    services.idp = {
      image: MOCK_IMAGES.idp,
      container_name: `${project}-ai-idp`,
      environment: { JSON_CONFIG_PATH: '/app/config.json' },
      volumes: ['./mocks/idp/config.json:/app/config.json:ro'],
      ports: [local(MOCK_PORTS.idp, 8080)],
      networks: ['ai-internal'],
      restart: 'unless-stopped',
    };
  }
  if (need.wiremock) {
    services.wiremock = {
      image: MOCK_IMAGES.wiremock,
      container_name: `${project}-ai-wiremock`,
      command: ['--global-response-templating', '--verbose'],
      volumes: ['./mocks/wiremock:/home/wiremock:ro'],
      ports: [local(MOCK_PORTS.wiremock, 8080)],
      networks: ['ai-internal'],
      restart: 'unless-stopped',
    };
  }
  if (need.prism) {
    services.prism = {
      image: MOCK_IMAGES.prism,
      container_name: `${project}-ai-prism`,
      // 0.0.0.0 es el bind DENTRO del contenedor; la publicación al host va solo a 127.0.0.1.
      command: ['mock', '-h', '0.0.0.0', '-p', '4010', '/tmp/openapi.yaml'],
      volumes: ['./mocks/prism/openapi.yaml:/tmp/openapi.yaml:ro'],
      ports: [local(MOCK_PORTS.prism, 4010)],
      networks: ['ai-internal'],
      restart: 'unless-stopped',
    };
  }
  if (need.mailpit) {
    services.mailpit = {
      image: MOCK_IMAGES.mailpit,
      container_name: `${project}-ai-mailpit`,
      ports: [local(MOCK_PORTS.smtp, 1025), local(MOCK_PORTS.mailpitUi, 8025)],
      networks: ['ai-internal'],
      restart: 'unless-stopped',
    };
  }
  if (need.stripe) {
    services['stripe-mock'] = {
      image: MOCK_IMAGES.stripe,
      container_name: `${project}-ai-stripe`,
      ports: [local(MOCK_PORTS.stripe, 12111)],
      networks: ['ai-internal'],
      restart: 'unless-stopped',
    };
  }
  if (need.s3) {
    services.localstack = {
      image: MOCK_IMAGES.localstack,
      container_name: `${project}-ai-localstack`,
      environment: { SERVICES: 's3,sqs,sns,secretsmanager', DEBUG: '0', AWS_DEFAULT_REGION: 'us-east-1' },
      ports: [local(MOCK_PORTS.aws, 4566)],
      networks: ['ai-internal'],
      restart: 'unless-stopped',
    };
  }
  if (need.redis) {
    services.redis = {
      image: MOCK_IMAGES.redis,
      container_name: `${project}-ai-redis`,
      ports: [local(MOCK_PORTS.redis, 6379)],
      networks: ['ai-internal'],
      restart: 'unless-stopped',
    };
  }

  // Apps con Dockerfile: opcionales (perfil `apps`), nunca se levantan por defecto.
  for (const app of apps) {
    if (!app?.hasDockerfile || !app.port) continue;
    services[slug(app.name)] = {
      profiles: ['apps'],
      build: { context: `./${app.path && app.path !== '.' ? app.path : '.'}` },
      container_name: `${project}-ai-${slug(app.name)}`,
      env_file: [`./${app.path && app.path !== '.' ? `${app.path}/` : ''}.env.ai`],
      environment: { AI_ENV: '1' },
      ports: [local(app.port)],
      networks: ['ai-internal'],
      depends_on: (app.dependsOn ?? []).filter((d) => d === 'db' || services[slug(d)]),
      restart: 'unless-stopped',
    };
    if (!services[slug(app.name)].depends_on.length) delete services[slug(app.name)].depends_on;
  }

  return {
    include: [DB_COMPOSE],
    services,
    networks: { 'ai-internal': { name: networkName(policy), internal: true } },
  };
}

/** `compose.ai.yml` con cabecera explicativa. */
export function renderComposeAi(policy, apps = []) {
  const head = [
    '# bot-secure: amarre del ambiente de IA (BD de pruebas + mocks). Nunca datos reales.',
    `# Proyecto ${policy?.project || 'app'} · red interna ${networkName(policy)} · puertos SOLO en 127.0.0.1.`,
    `# Incluye ${DB_COMPOSE} (lo genera \`bot-secure db init\`).`,
    '# Levantar: bot-secure mocks up   ·   con las apps: docker compose -f compose.ai.yml --profile apps up -d',
    '# Generado; regenerar con: bot-secure init',
    '',
  ].join('\n');
  return head + toYaml(composeAiObject(policy, apps));
}

/** Artefacto de compose.ai.yml. */
export function generateCompose(policy, apps = []) {
  return [{ path: COMPOSE_FILE, content: renderComposeAi(policy, apps) }];
}

/** Puertos publicados (para pruebas y para `doctor`): todos deben empezar por 127.0.0.1. */
export function publishedPorts(policy, apps = []) {
  const obj = composeAiObject(policy, apps);
  return Object.values(obj.services).flatMap((s) => s.ports ?? []);
}
