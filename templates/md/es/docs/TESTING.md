# Pruebas — {{project}}

Lee esto cuando termines un cambio (evidencia obligatoria) o añadas pruebas. Regla: corre solo el test del archivo tocado; la suite completa solo si te la piden.

## Un test por app
| App | Desde | UN archivo/clase | Suite |
|---|---|---|---|
{{#each apps}}
| {{name}} ({{stack}}) | `./{{pathPosix}}` | `{{testOneCmd}}` | {{#if testCmd}}`{{testCmd}}`{{/if}}{{#unless testCmd}}(pendiente){{/unless}} |
{{/each}}
{{#unless hasApps}}
| (sin apps registradas) | — | — | — |
{{/unless}}

Sustituye `<ruta>`/`<Clase>` por el archivo o clase real. Si un comando no funciona en tu máquina, corrígelo aquí y en `AGENTS.md` en el mismo PR.

## Dónde viven las pruebas
{{#each apps}}
- **{{name}}**: {{#each testGlobs}}`{{.}}`{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}
<!-- TODO (/bootstrap-contexto): confirma las rutas reales y el runner (jest/vitest/pytest/JUnit…) por app. -->

## Datos de prueba
- Integración/e2e: BD de IA del workspace ({{#if hasDb}}{{db.engine}} en `{{db.hostPort}}`{{/if}}{{#unless hasDb}}pendiente de configurar{{/unless}}) con seeds sintéticos deterministas (`bot-secure db seed --rows N`). Nunca dumps reales.
- Unitarias: fixtures con valores de formato válido pero inventados. RFC/CURP/CLABE/NSS: usa los del seed sintético o genera con checksum válido; tarjetas: números de prueba de los proveedores (por ejemplo `4242 4242 4242 4242`).
- Criterios de aceptación de las HU están en Gherkin (`# language: es`): conviértelos en tests antes de implementar.

## Evidencia en el PR
Pega la salida real (últimas líneas) del comando de UN test en la sección "Evidencia" de la plantilla de PR.
