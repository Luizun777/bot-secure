// Generación de `mocks/db/compose.db.yml`. Serializador YAML mínimo (subconjunto: mapas, listas,
// cadenas, números y booleanos) para no depender de ninguna librería.
import { DB_PASSWORD_PLACEHOLDER, SQL_MOUNT, dbContainerName, dbOf } from './engines/_common.mjs';

const NEEDS_QUOTE = /^$|^[\s#&*!|>%@`'"-]|[:#]|\s$|^(y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|false|False|on|On|off|Off|null|Null|~)$|^-?\d+(\.\d+)?$/;

/** Escala YAML seguro: se citan cadenas ambiguas con comillas dobles. */
export function yamlScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  return NEEDS_QUOTE.test(s) ? JSON.stringify(s) : s;
}

/** Serializa un objeto/array plano a YAML con indentación de 2 espacios. */
export function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]\n`;
    return value.map((v) => (v !== null && typeof v === 'object'
      ? `${pad}-\n${toYaml(v, indent + 2)}`
      : `${pad}- ${yamlScalar(v)}\n`)).join('');
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (!keys.length) return `${pad}{}\n`;
    return keys.map((k) => {
      const v = value[k];
      if (v !== null && typeof v === 'object') {
        const body = toYaml(v, indent + 2);
        return body.trim() === '{}' || body.trim() === '[]' ? `${pad}${k}: ${body.trim()}\n` : `${pad}${k}:\n${body}`;
      }
      return `${pad}${k}: ${yamlScalar(v)}\n`;
    }).join('');
  }
  return `${pad}${yamlScalar(value)}\n`;
}

/** Nombre del volumen de datos: `<proyecto>-ai-db`. */
export const volumeName = (policy) => dbContainerName(policy);

/**
 * Objeto compose de la BD de pruebas. Puertos SIEMPRE atados a 127.0.0.1 y red interna.
 * @param {object} engine motor de `src/db/engines`
 * @param {object} policy
 * @returns {object}
 */
export function composeObject(engine, policy) {
  const d = dbOf(policy, engine);
  const name = dbContainerName(policy);
  const volumes = [`${name}:${engine.dataPath}`, `./:${SQL_MOUNT}:ro`];
  if (engine.initPath) volumes.splice(1, 0, `./init:${engine.initPath}:ro`);
  const service = {
    image: engine.image,
    container_name: name,
    restart: 'unless-stopped',
    environment: engine.env(policy),
    ports: [`127.0.0.1:${d.port}:${engine.defaultPort}`],
    volumes,
    healthcheck: engine.healthcheck(policy),
    networks: ['ai-internal'],
  };
  if (engine.command) service.command = engine.command;
  return {
    services: { db: service },
    volumes: { [name]: { name } },
    networks: { 'ai-internal': { name: `${policy?.project || 'proyecto'}-ai-internal`, internal: true } },
  };
}

/** `mocks/db/compose.db.yml` completo (con cabecera explicativa). */
export function renderCompose(engine, policy) {
  const d = dbOf(policy, engine);
  const head = [
    '# bot-secure: base de datos de PRUEBAS para el ambiente de IA. Nunca datos reales.',
    `# Motor ${engine.name} · puerto ${d.port} solo en 127.0.0.1 · volumen ${dbContainerName(policy)}.`,
    `# La contraseña es literalmente el placeholder de .env.ai (${DB_PASSWORD_PLACEHOLDER}).`,
    '# Generado; regenerar con: bot-secure db init',
    '',
  ].join('\n');
  return head + toYaml(composeObject(engine, policy));
}

/** `mocks/db/init/00-roles.sql`: usuario de aplicación con la contraseña placeholder. */
export function renderRolesSql(engine, policy) {
  const d = dbOf(policy, engine);
  const head = [
    '-- bot-secure: rol de aplicación de la BD de PRUEBAS (contraseña = placeholder de .env.ai).',
    '-- Generado; regenerar con: bot-secure db init',
    '',
  ].join('\n');
  if (engine.name === 'postgres') {
    return head + [
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${d.user}') THEN`,
      `  CREATE ROLE ${d.user} LOGIN PASSWORD '${DB_PASSWORD_PLACEHOLDER}';`,
      'END IF; END $$;',
      `GRANT ALL PRIVILEGES ON DATABASE ${d.database} TO ${d.user};`,
      `ALTER DATABASE ${d.database} OWNER TO ${d.user};`,
      '',
    ].join('\n');
  }
  if (engine.name === 'mysql') {
    return head + [
      `CREATE USER IF NOT EXISTS '${d.user}'@'%' IDENTIFIED BY '${DB_PASSWORD_PLACEHOLDER}';`,
      `GRANT ALL PRIVILEGES ON ${d.database}.* TO '${d.user}'@'%';`,
      'FLUSH PRIVILEGES;',
      '',
    ].join('\n');
  }
  return head + `-- ${engine.name}: el usuario de aplicación lo crea la propia imagen con las variables de entorno del compose.\n`;
}
