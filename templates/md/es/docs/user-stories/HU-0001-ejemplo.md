---
id: HU-0001
epica: ejemplo
estado: borrador
prioridad: media
owner: equipo de {{project}}
datos-sensibles: [RFC, correo, telefono]
---
# HU-0001 — Ejemplo: alta de cliente con validación de RFC

<!-- HU de ejemplo generada por bot-secure. Muestra el formato; bórrala o reemplázala cuando exista la primera HU real. Todos los datos son sintéticos. -->

## Historia
**Como** operador de mostrador
**quiero** dar de alta a un cliente capturando su RFC, correo y teléfono
**para** poder facturarle sin errores de captura

## Criterios de aceptación
```gherkin
# language: es
Característica: Alta de cliente con RFC válido

  Antecedentes:
    Dado que existe un operador sintético autenticado en el IdP mock

  Escenario: RFC de persona física válido
    Dado que el operador está en el formulario de alta
    Cuando captura el RFC "GOCM850101AB1" y el correo "maria.gomez@ai.local"
    Entonces el sistema guarda el cliente
    Y muestra "Cliente creado"

  Escenario: RFC con dígito verificador incorrecto
    Dado que el operador está en el formulario de alta
    Cuando captura el RFC "GOCM850101AB9"
    Entonces el sistema no guarda el cliente
    Y muestra "RFC inválido: revisa la homoclave"
    Pero no muestra el RFC en los logs

  Esquema del escenario: Longitud del RFC
    Dado que el operador captura el RFC "<rfc>"
    Cuando envía el formulario
    Entonces el resultado es "<resultado>"

    Ejemplos:
      | rfc            | resultado |
      | XAXX010101000  | aceptado  |
      | ABC123         | rechazado |
```

## Datos sensibles involucrados
- Tipo: RFC · Uso: facturación (CFDI) · En IA: sintético del seed (`bot-secure db seed`), checksum válido, persona inexistente.
- Tipo: correo y teléfono · Uso: contacto · En IA: `@ai.local` y `+52 55 0000 xxxx`.
- Regla: el RFC nunca aparece en logs ni mensajes de error completos (enmascarar).

## Fuera de alcance
- Validación del RFC contra el SAT en línea (requiere servicio externo; en IA no existe).
- Alta de persona moral.

## DoD (Definition of Done)
- [ ] Tests de los tres escenarios pasan (comando de UN test en `docs/TESTING.md`).
- [ ] Sin datos personales reales en fixtures.
- [ ] Sin variables nuevas o documentadas en `docs/RUNBOOK.md` y `.env.ai`.
- [ ] Docs actualizadas; INDEX.md con estado `hecha`.
