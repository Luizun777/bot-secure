---
description: Reglas del backend de {{project}} ({{ruleNames}}).
paths: {{rulePaths}}
---
# Backend — {{ruleNames}}

## Configuración
- Campo sensible en la configuración versionada = `""`. El loader de IA lo resuelve desde `.env.ai` con `AI_ENV=1`; sin `AI_ENV` la app debe fallar nombrando el campo. No añadas defaults con valores reales ni "de ejemplo".
- Arranca siempre en modo IA (comando por app en `AGENTS.md`).{{#if hasDb}} La BD de IA es {{db.engine}} en `{{db.hostPort}}`, base `{{db.database}}`; si está abajo: `bot-secure up`.{{/if}}
- Todo lo externo (identidad, pagos, correo, almacenamiento) apunta a un mock local. No introduzcas llamadas a hosts de producción ni a servicios de terceros reales.

## Datos y persistencia
- Los datos son sintéticos (`bot-secure:synthetic`). No importes dumps; no existe `db import`.
- Migraciones: una por cambio, reversible, versionada con el código. Nunca escribas datos personales en un `INSERT` de migración.
- Si una entidad guarda RFC/CURP/CLABE/NSS/tarjeta/contacto, anótala en `docs/ARCHITECTURE.md` → "Datos sensibles por tabla o entidad".

## Logs, errores y API
- Nunca loguees credenciales, cuerpos completos de peticiones con datos personales, ni identificadores sin enmascarar.
- Los errores hacia el cliente no filtran stack traces, nombres de host ni consultas SQL.
- Cambio en un endpoint público (ruta, contrato, códigos de estado) → actualiza `docs/ARCHITECTURE.md` en el mismo PR y avisa al frontend en la descripción del PR.

## Cambios
- Validación de datos mexicanos (RFC, CURP, CLABE, NSS): valida el dígito verificador, no solo la longitud; prueba con valores sintéticos válidos e inválidos.
- Cambio que cruza apps o toca una frontera (API, BD, auth) → plan mode primero.
- Tras cada cambio corre el test del archivo tocado (comando en `docs/TESTING.md`) y pega la salida real.
