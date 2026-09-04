# Arquitectura — {{project}}

Lee esto cuando vayas a tocar más de una app o una frontera (API, BD, autenticación). Esqueleto generado por bot-secure; complétalo con `/bootstrap-contexto` describiendo patrones, nunca valores, hosts ni datos reales.

## Mapa del workspace
{{appMap}}

```text
{{#each frontends}}
[{{name}} ({{stack}}{{#if hasPort}} :{{port}}{{/if}})] --HTTP--> {{#if consumes}}[{{consumesName}}] en {{consumes}}{{/if}}{{#unless consumes}}[backend]{{/unless}}
{{/each}}
{{#each mobiles}}
[{{name}} ({{stack}})] --HTTP--> {{#if consumes}}[{{consumesName}}] en {{consumes}}{{/if}}{{#unless consumes}}[backend]{{/unless}}
{{/each}}
{{#each backends}}
[{{name}} ({{stack}}{{#if hasPort}} :{{port}}{{/if}})] --{{#if usesDb}}{{db.engine}}--> [BD de IA {{db.hostPort}}/{{db.database}}]{{/if}}{{#unless usesDb}}?--> [BD]{{/unless}}
{{/each}}
```
En modo IA (`AI_ENV=1`) toda dependencia externa se resuelve a local: BD Docker del workspace, IdP mock, back local. Nada apunta a servidores reales.

## Capas y responsabilidades
<!-- TODO (/bootstrap-contexto): por app, 3-6 líneas: entrada (controladores/páginas), dominio, acceso a datos, integraciones. Solo nombres de módulos y patrones. -->

## Flujo de una petición típica
<!-- TODO: front → endpoint → servicio → repositorio → tabla. Un ejemplo real del código (nombres, no datos). -->

## Fronteras y contratos
<!-- TODO: API (REST/GraphQL/gRPC), versionado, autenticación (IdP, tokens: solo el mecanismo, jamás valores), colas/eventos. -->

## Datos sensibles por tabla o entidad
<!-- TODO: qué entidades guardan RFC/CURP/CLABE/NSS/tarjetas/contacto. Sirve para decidir qué se mockea y qué nunca se copia. Ver SECURITY.md. -->

## Decisiones relevantes
Ver `decisions/` (ADR). Las del bot: 0001 rama `{{branches.ai}}` y placeholders, 0002 guarda de rama, 0003 workspace de IA.
