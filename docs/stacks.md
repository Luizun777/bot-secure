# Stacks: la regla del campo vacío y cómo entra `.env.ai` en cada tecnología

## La regla del campo vacío

En la rama de IA (`ai-dev`) **no pongas valores reales ni placeholders inventados en tu configuración: deja el campo vacío**.

```jsonc
// appsettings.json (en ai-dev)
{ "ConnectionStrings": { "Default": "" } }
```
```yaml
# application.yml (en ai-dev)
spring:
  datasource:
    url: ""
    username: ""
    password: ""
```
```ts
// src/environments/environment.ts (en ai-dev)
export const environment = { production: false, apiUrl: '' };
```

Cuando la app arranca con `AI_ENV=1`, el pequeño loader que genera el bot (`AiEnv.java`, `AiEnv.cs`, `ai-env.ts`, `ai_env.py`…) ve el campo vacío y lo rellena con el valor de **`.env.ai`**: la base de datos de pruebas en Docker, el IdP simulado, el backend local. Sin `AI_ENV`, un campo vacío hace fallar el arranque con un mensaje claro, que es justo lo que quieres en `dev`/`qa`/`prd` (ahí los valores vienen del entorno o del gestor de secretos).

Ventajas: el código de `ai-dev` y `dev` es idéntico, no hay placeholders que "parezcan token", y el gate de CI rechaza cualquier valor real, placeholder o fake que alguien deje en esos campos.

## `.env.ai`

Es la única fuente de valores de IA. Está versionado y no contiene nada secreto:

```bash
AI_ENV=1
DATABASE_URL=postgresql://app:__AI_PLACEHOLDER__DB_PASSWORD__@127.0.0.1:5433/app_ai
OIDC_ISSUER=http://localhost:8081/default
API_URL=http://localhost:8080
STRIPE_SECRET_KEY=sk_test_AIPLACEHOLDER000000000000000000   # bot-secure:fake stripe-secret
AWS_STORAGE_BUCKET_NAME=ai-tienda-bucket
```

- `__AI_PLACEHOLDER__X__` solo para credenciales que aceptan cualquier texto.
- Los SDK que validan el formato (Twilio, Stripe, Clerk, JWT ≥ 64 caracteres…) reciben un **valor falso pero válido por formato**, marcado con `# bot-secure:fake`.
- Hosts, URLs, buckets, GUIDs y correos reciben valores válidos (`localhost`, `ai-<proyecto>-bucket`, `noreply@ai.local`).

## Matriz por stack

| Stack | Cómo entra `.env.ai` | Archivo que genera el bot | Arranque en modo IA |
|---|---|---|---|
| **Angular** | No lee `.env`. Usa `environment.ai.ts` + configuración `ai` en `angular.json` (`fileReplacements`) | `src/environments/environment.ai.ts`, parche a `angular.json`, `src/app/ai-env.ts` | `npm run start:ai` (= `ng serve -c ai`) |
| Vite / React (CRA) / Vue / Next / Nuxt / SvelteKit | Nativo: variables con prefijo público (`VITE_`, `REACT_APP_`, `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `PUBLIC_`) | `.env.ai` | `npm run dev -- --mode ai` / `dotenv -e .env.ai` |
| Expo / React Native | `app.config.js` lee `.env.ai` | `app.config.js`, `.env.ai` | `EXPO_PUBLIC_AI_ENV=1 npx expo start` |
| Flutter | `--dart-define-from-file` | `ai.env.json` | `flutter run --dart-define-from-file=ai.env.json` |
| Node / Nest / Express | `node --env-file=.env.ai` o `dotenv` | `.env.ai`, `ai-env.ts` | `npm run start:ai` |
| Spring Boot / Quarkus / Micronaut | Perfil `ai` (`application-ai.yml`, `%ai.` en Quarkus) | `application-ai.yml`, `AiEnv.java` | `SPRING_PROFILES_ACTIVE=dev,ai ./mvnw spring-boot:run` |
| .NET | `appsettings.AI.json` cargado si `AI_ENV=1`, manteniendo `Development` | `appsettings.AI.json`, `AiEnv.cs`, snippet para `Program.cs` | `AI_ENV=1 dotnet run` |
| Django | Bloque en `settings.py` o `settings/ai.py` | `settings/ai.py`, `ai_env.py` | `AI_ENV=1 python manage.py runserver` |
| FastAPI / Flask | `python-dotenv` | `.env.ai`, `ai_env.py` | `AI_ENV=1 uvicorn app:app` |
| Laravel / Symfony / Rails | `.env.ai` manteniendo `APP_ENV=local` / `dev` | `.env.ai`, `AiEnv.php` | `AI_ENV=1 php artisan serve` |
| Go | Loader mínimo | `internal/aienv/aienv.go` | `AI_ENV=1 go run .` |
| PHP clásico | `config.ai.php` vía `getenv` | `config.ai.php` | `AI_ENV=1 php -S localhost:8000` |
| Android | `local.properties.ai` → `BuildConfig` en el flavor `ai` | `local.properties.ai`, snippet Gradle | `./gradlew assembleAiDebug` |
| iOS | `AI.xcconfig` + scheme `AI` | `AI.xcconfig` | Xcode, scheme `AI` |

Si tu stack no está en la lista, el bot deja `envStrategy: manual` y una lista de pendientes en `SANITIZE-TODO.md`.

## Adaptadores por SDK

Algunos SDK no se mockean con una variable de entorno. El bot detecta el SDK en tu manifiesto y propone el cambio concreto (como diff revisable con `sanitize --refactor`):

| SDK | Qué hace el adaptador en modo IA |
|---|---|
| Stripe | Apunta el cliente a `stripe-mock` (`host/port/protocol` o `api_base`) |
| SendGrid | `baseUrl` a un mock local |
| Twilio | `HttpClient` hacia Prism con el OpenAPI público de Twilio |
| Firebase | `connect*Emulator` + proyecto `demo-<proyecto>-ai` (requiere Java) |
| Supabase | URL local |
| AWS (boto3 / SDK v3) | `AWS_ENDPOINT_URL` a LocalStack/MinIO |
| Key Vault / Secrets Manager / Vault / Config Server | Se omite el proveedor cuando `AI_ENV=1` |
| Google Maps / Stripe.js / reCAPTCHA / Sentry en el front | Proveedor alterno (Leaflet), stub, llaves de prueba oficiales, apagado |

## Claves "públicas" del front

`NEXT_PUBLIC_*`, `VITE_*` y similares terminan en el bundle: son públicas. Eso no las hace inocuas: una API key de Google sin restricción de referrer genera facturas ajenas; una clave `service_role` de Supabase o `sk.` de Mapbox en el front es una fuga total. El escáner las clasifica por valor, no por nombre.
