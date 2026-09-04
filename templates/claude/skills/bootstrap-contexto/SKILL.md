---
name: bootstrap-contexto
description: Completa docs/ (arquitectura, convenciones, pruebas, runbook) leyendo el código del workspace, sin copiar valores reales. Ejecuta en plan mode. Invócala con /bootstrap-contexto.
disable-model-invocation: true
argument-hint: [app o documento a completar]
---
# Bootstrap del contexto

Procedimiento para `/bootstrap-contexto`, el primer día en {{project}}. No lo ejecutes por tu cuenta.

## IMPORTANT: cómo se trabaja
- **Entra en plan mode y quédate en plan mode** hasta que el humano apruebe el plan. Primero lees y propones; solo después escribes.
- **No copies valores, hosts ni datos reales.** Describe patrones: "la conexión a la BD se configura por variable de entorno", no la cadena de conexión. Nombres de módulos, clases y rutas sí; valores no.
- Marca con `(?)` toda afirmación que no puedas verificar en el código, y lístalas al final para que el humano las confirme. Es mejor un hueco marcado que un dato falso.
- No leas `.env*` (salvo `.env.example` y `.env.ai`), llaves ni dumps.

## Pasos
1. Lee `AGENTS.md` (mapa de apps), `.bot-secure/policy.json` y el `README`/manifiesto de cada app.
2. Explora con el subagente `explorador` (una tarea por app): estructura de carpetas, punto de entrada, capas, ORM y migraciones, framework de pruebas, configuración. Pídele rutas + resumen, no volcados.
3. Propón en el plan qué vas a escribir en cada documento y qué preguntas quedan abiertas.
4. Con el plan aprobado, completa los `<!-- TODO -->` de:
   - `docs/ARCHITECTURE.md` — capas y responsabilidades por app, flujo de una petición típica, fronteras y contratos, datos sensibles por tabla o entidad.
   - `docs/CONVENTIONS.md` — solo lo que difiere del default: formateador, nombres, estructura, manejo de errores, logging.
   - `docs/TESTING.md` — runner real, rutas de tests, comando de UN test verificado por app.
   - `docs/RUNBOOK.md` — matriz de dependencias externas → mock, tabla de variables de `.env.ai` (nombre y para qué, nunca el valor), puertos.
   - `docs/GLOSSARY.md` — siglas propias del negocio que encuentres en el código.
5. Verifica los comandos que documentes ejecutándolos (arranque en modo IA y UN test por app) y pega la salida real. Si uno falla, corrígelo en el documento y anótalo.
6. Actualiza `docs/INDEX.md` si creaste algún documento y resume al humano: qué completaste, qué quedó con `(?)` y qué comandos verificaste.

## Presupuestos
`CLAUDE.md` raíz ≤ 60 líneas, `AGENTS.md` ≤ 80, `CLAUDE.md` de app ≤ 25. Todo lo demás va a `docs/`. No reescribas esos archivos generados salvo la sección de lecciones: lo demás lo regenera `bot-secure init`.
