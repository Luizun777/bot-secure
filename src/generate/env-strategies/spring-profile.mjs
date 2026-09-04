// Spring Boot / Quarkus / Micronaut: perfil `ai` que se SUMA a `dev` (nunca lo reemplaza).
import { aiContext, appVars, banner, docsBlock, esc, file } from './_common.mjs';

export const id = 'spring-profile';

const isQuarkus = (app) => app?.stack === 'quarkus';

/** application-ai.yml: cada propiedad usa ${VAR:} para que el valor VACÍO sea el default. */
function applicationAiYml(c) {
  const extra = appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20);
  return [
    banner('#'),
    '# Perfil `ai`: se activa con SPRING_PROFILES_ACTIVE=dev,ai (mantiene `dev`).',
    '# `${VAR:}` = toma la variable de entorno y, si no está, deja el valor VACÍO;',
    '# AiEnv rellena los vacíos con los valores del ambiente de IA cuando AI_ENV=1.',
    'spring:',
    '  datasource:',
    `    url: \${JDBC_DATABASE_URL:}`,
    `    username: \${DB_USER:}`,
    `    password: \${DB_PASSWORD:}`,
    '  jpa:',
    '    hibernate:',
    '      ddl-auto: validate',
    '  security:',
    '    oauth2:',
    '      resourceserver:',
    '        jwt:',
    '          issuer-uri: ${OIDC_ISSUER:}',
    '          jwk-set-uri: ${OIDC_JWKS_URI:}',
    'bot-secure:',
    '  ai-env: true',
    ...(extra.length ? ['app:'] : []),
    ...extra.map((v) => `  ${kebab(v.name)}: \${${v.name}:}`),
    '',
  ].join('\n');
}

/** application-ai.properties para Quarkus (prefijo %ai.). */
function applicationAiProperties(c) {
  const extra = appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20);
  return [
    banner('#'),
    '# Perfil `ai` de Quarkus: se activa con QUARKUS_PROFILE=dev,ai.',
    '%ai.quarkus.datasource.jdbc.url=${JDBC_DATABASE_URL:}',
    '%ai.quarkus.datasource.username=${DB_USER:}',
    '%ai.quarkus.datasource.password=${DB_PASSWORD:}',
    '%ai.quarkus.oidc.auth-server-url=${OIDC_ISSUER:}',
    '%ai.bot-secure.ai-env=true',
    ...extra.map((v) => `%ai.app.${kebab(v.name)}=\${${v.name}:}`),
    '',
  ].join('\n');
}

function kebab(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'valor'; }

/** AiEnv.java: EnvironmentPostProcessor que rellena SOLO las propiedades vacías. */
function aiEnvJava(c) {
  const rows = [
    ['spring.datasource.url', c.jdbcUrl],
    ['spring.datasource.username', c.db.user || 'app'],
    ['spring.datasource.password', c.db.password || '__AI_PLACEHOLDER__DB_PASSWORD__'],
    ['spring.security.oauth2.resourceserver.jwt.issuer-uri', c.issuer],
    ['spring.security.oauth2.resourceserver.jwt.jwk-set-uri', c.jwks],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [`app.${kebab(v.name)}`, v.value]),
  ];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('//'),
    'package aienv;',
    '',
    'import java.util.HashMap;',
    'import java.util.Map;',
    'import org.springframework.boot.SpringApplication;',
    'import org.springframework.boot.env.EnvironmentPostProcessor;',
    'import org.springframework.core.env.ConfigurableEnvironment;',
    'import org.springframework.core.env.MapPropertySource;',
    '',
    '/**',
    ' * Regla del campo vacío: si AI_ENV=1 y una propiedad está VACÍA, se rellena con el valor del',
    ' * ambiente de IA. Sin AI_ENV, la propiedad vacía hace fallar el arranque con su nombre (correcto',
    ' * en dev/qa/prd). Registrado en META-INF/spring.factories.',
    ' */',
    'public class AiEnv implements EnvironmentPostProcessor {',
    '',
    '  private static final Map<String, String> AI_VALUES = new HashMap<>();',
    '',
    '  static {',
    ...uniq.map(([k, v]) => `    AI_VALUES.put("${esc(k)}", "${esc(v)}");`),
    '  }',
    '',
    '  @Override',
    '  public void postProcessEnvironment(ConfigurableEnvironment env, SpringApplication app) {',
    '    if (!"1".equals(env.getProperty("AI_ENV"))) {',
    '      return;',
    '    }',
    '    Map<String, Object> filled = new HashMap<>();',
    '    for (Map.Entry<String, String> e : AI_VALUES.entrySet()) {',
    '      String current = env.getProperty(e.getKey());',
    '      if (current == null || current.isBlank()) {',
    '        filled.put(e.getKey(), e.getValue());',
    '      }',
    '    }',
    '    if (!filled.isEmpty()) {',
    '      env.getPropertySources().addFirst(new MapPropertySource("bot-secure-ai-env", filled));',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}

const SPRING_FACTORIES = [
  '# bot-secure: registra el cargador del ambiente de IA (solo actúa con AI_ENV=1).',
  'org.springframework.boot.env.EnvironmentPostProcessor=\\',
  '  aienv.AiEnv',
  '',
].join('\n');

export function runCmdAi(app) {
  if (isQuarkus(app)) return 'QUARKUS_PROFILE=dev,ai AI_ENV=1 ./mvnw quarkus:dev';
  const mvn = app?.packageManager === 'gradle' ? './gradlew bootRun' : './mvnw spring-boot:run';
  return `SPRING_PROFILES_ACTIVE=dev,ai AI_ENV=1 ${mvn}`;
}

export function loaderSnippet(app) {
  return {
    file: isQuarkus(app) ? 'src/main/resources/application-ai.properties' : 'src/main/resources/META-INF/spring.factories',
    lang: 'properties',
    code: isQuarkus(app)
      ? '%ai.quarkus.datasource.jdbc.url=${JDBC_DATABASE_URL:}'
      : SPRING_FACTORIES.trim(),
  };
}

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  if (isQuarkus(app)) return [file(app, 'src/main/resources/application-ai.properties', applicationAiProperties(c))];
  return [
    file(app, 'src/main/resources/application-ai.yml', applicationAiYml(c)),
    file(app, 'src/main/java/aienv/AiEnv.java', aiEnvJava(c)),
    file(app, 'src/main/resources/META-INF/spring.factories', SPRING_FACTORIES),
  ];
}

export function docs(app) {
  return docsBlock({
    title: `${isQuarkus(app) ? 'Quarkus' : 'Spring Boot'} (${app?.name ?? 'backend'})`,
    runCmd: runCmdAi(app),
    files: isQuarkus(app)
      ? ['src/main/resources/application-ai.properties']
      : ['src/main/resources/application-ai.yml', 'src/main/java/aienv/AiEnv.java', 'src/main/resources/META-INF/spring.factories'],
    notes: [
      'El perfil `ai` **se suma** a `dev` (`SPRING_PROFILES_ACTIVE=dev,ai`): no es un entorno nuevo.',
      'En `ai-dev`, `application.yml` deja `spring.datasource.url: ""`. `AiEnv` solo rellena lo VACÍO y solo con `AI_ENV=1`.',
      'Sin `AI_ENV`, un campo vacío hace fallar el arranque con el nombre de la propiedad: eso es lo deseado en dev/qa/prd.',
    ],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
