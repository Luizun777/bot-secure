---
id: {{#if huId}}{{huId}}{{/if}}{{#unless huId}}HU-NNNN{{/unless}}
epica: {{#if huEpica}}{{huEpica}}{{/if}}{{#unless huEpica}}<!-- nombre de la épica -->{{/unless}}
estado: borrador
prioridad: media
owner: {{#if huOwner}}{{huOwner}}{{/if}}{{#unless huOwner}}<!-- rol o equipo -->{{/unless}}
datos-sensibles: [] # tipos, no valores: [RFC, CLABE, correo]
---
# {{#if huId}}{{huId}}{{/if}}{{#unless huId}}HU-NNNN{{/unless}} — {{#if huTitulo}}{{huTitulo}}{{/if}}{{#unless huTitulo}}Título corto en infinitivo o sustantivo{{/unless}}

<!-- Copia este archivo a HU-NNNN-slug.md (número consecutivo de INDEX.md). Ejemplos siempre sintéticos: personas, RFC, cuentas y correos inventados (`@ai.local`). -->

## Historia
**Como** <!-- rol (cliente, cajero, administrador…) -->
**quiero** <!-- acción concreta -->
**para** <!-- valor de negocio -->

## Criterios de aceptación
```gherkin
# language: es
Característica: <!-- nombre de la funcionalidad -->

  Antecedentes:
    Dado que existe un usuario sintético con rol "<rol>"

  Escenario: <!-- camino feliz -->
    Dado que <!-- estado inicial -->
    Cuando <!-- acción -->
    Entonces <!-- resultado observable -->
    Y <!-- efecto adicional -->

  Escenario: <!-- caso de error o borde -->
    Dado que <!-- estado inicial -->
    Cuando <!-- acción inválida -->
    Entonces <!-- mensaje o comportamiento esperado -->
    Pero <!-- lo que NO debe pasar -->

  Esquema del escenario: <!-- variaciones -->
    Dado que el campo "<campo>" vale "<valor>"
    Cuando se envía el formulario
    Entonces el resultado es "<resultado>"

    Ejemplos:
      | campo | valor | resultado |
      | rfc   | XAXX010101000 | aceptado |
```

## Datos sensibles involucrados
<!-- Tipos y por qué se necesitan (RFC para facturar, CLABE para dispersión…). Cómo se mockean en IA (seed sintético, fake). Nunca valores reales. -->
- Tipo: <!-- RFC/CURP/CLABE/NSS/tarjeta/contacto/credencial --> · Uso: <!-- … --> · En IA: <!-- sintético / fake / vacío -->

## Fuera de alcance
- <!-- qué NO incluye esta HU -->

## DoD (Definition of Done)
- [ ] Criterios Gherkin convertidos en tests que pasan (comando de UN test en `docs/TESTING.md`).
- [ ] Sin secretos ni datos personales reales en código, tests, fixtures ni docs.
- [ ] Campos sensibles de configuración siguen vacíos; variables nuevas documentadas en `docs/RUNBOOK.md` y `.env.ai`.
- [ ] Docs actualizadas (`/sync-docs`); ADR si hubo decisión.
- [ ] PR a `dev` con la plantilla y evidencia; revisión aprobada.
- [ ] INDEX.md actualizado con el estado.
