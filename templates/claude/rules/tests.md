---
description: Cómo se escriben y se corren las pruebas en {{project}}.
paths: {{rulePaths}}
---
# Pruebas

## Cómo se corre
- Corre **solo el test del archivo tocado**; la suite completa únicamente si el humano la pide. El comando por app está en `docs/TESTING.md` y en `AGENTS.md`.
- La evidencia es obligatoria: pega la salida real (últimas líneas) del comando, no un resumen. Si no corriste el test, dilo; no afirmes que pasa.
- Si un test falla dos veces por la misma causa y no lo arreglas, para, resume qué aprendiste y pídele al humano un enfoque nuevo.

## Qué datos se usan
- Datos sintéticos siempre: seed del workspace (`bot-secure db seed`, marcado `bot-secure:synthetic`) o fixtures inventados con formato válido.
- RFC/CURP/CLABE/NSS de prueba: dígito verificador correcto, persona inexistente. Correos `@ai.local`. Teléfonos `+52 55 0000 ….` Tarjetas: números de prueba del proveedor.
- Nunca copies un caso real de producción a un test, ni siquiera "para reproducir el bug": describe el patrón y genera el dato.
- Los campos sensibles de configuración siguen vacíos también en tests; el valor viene de `.env.ai` con `AI_ENV=1`.

## Qué se prueba
- Toda corrección de bug trae su test de regresión.
- Los criterios Gherkin de las HU (`docs/user-stories/`, `# language: es`) se convierten en tests antes de implementar.
- Casos borde de datos mexicanos: longitud, homoclave, dígito verificador inválido, mayúsculas/acentos.
- No pruebes el framework; prueba tu lógica. Un test que no puede fallar no sirve.

## Qué no se hace
- No cambies el test para que pase: corrige el código o justifica el cambio del criterio en el PR.
- No borres ni marques como `skip` tests ajenos sin decirlo explícitamente.
- No metas llamadas de red reales en pruebas: todo mock o contenedor local.
