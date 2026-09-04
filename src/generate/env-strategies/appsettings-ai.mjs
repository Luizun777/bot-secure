// .NET: appsettings.AI.json cargado SOLO si AI_ENV=1, manteniendo el entorno Development.
import { aiContext, appVars, banner, docsBlock, esc, file } from './_common.mjs';

export const id = 'appsettings-ai';

function pascal(name) {
  return String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') || 'Valor';
}

function appsettingsAi(c) {
  const app = {};
  for (const v of appVars(c).filter((x) => x.kind !== 'plain').slice(0, 20)) app[pascal(v.name)] = v.value;
  const obj = {
    $comment: 'bot-secure: valores del ambiente de IA (falsos pero válidos por formato). Solo se carga con AI_ENV=1.',
    BotSecure: { AiEnv: true },
    ConnectionStrings: { Default: c.adoUrl },
    Oidc: { Authority: c.issuer, JwksUri: c.jwks, RequireHttpsMetadata: false },
    AzureAd: { Instance: `${c.issuer}/`, TenantId: '00000000-0000-4000-8000-000000000000' },
    Api: { BaseUrl: c.apiUrl },
    Logging: { LogLevel: { Default: 'Information' } },
  };
  if (Object.keys(app).length) obj.App = app;
  return JSON.stringify(obj, null, 2) + '\n';
}

function aiEnvCs(c) {
  const rows = [
    ['ConnectionStrings:Default', c.adoUrl],
    ['Oidc:Authority', c.issuer],
    ['Oidc:JwksUri', c.jwks],
    ['Api:BaseUrl', c.apiUrl],
    ...appVars(c).filter((v) => v.kind !== 'plain').slice(0, 20).map((v) => [`App:${pascal(v.name)}`, v.value]),
  ];
  const seen = new Set();
  const uniq = rows.filter(([k]) => (seen.has(k) ? false : seen.add(k)));
  return [
    banner('//'),
    'using System;',
    'using System.Collections.Generic;',
    'using Microsoft.Extensions.Configuration;',
    'using Microsoft.Extensions.DependencyInjection;',
    '',
    'namespace BotSecure;',
    '',
    '/// <summary>',
    '/// Regla del campo vacío: con AI_ENV=1, las claves VACÍAS se rellenan con los valores del',
    '/// ambiente de IA. El entorno sigue siendo Development (no se inventa un entorno nuevo):',
    '/// solo se apagan Swagger y la página de errores de desarrollo.',
    '/// </summary>',
    'public static class AiEnv',
    '{',
    '    public static bool IsAiEnv =>',
    '        Environment.GetEnvironmentVariable("AI_ENV") == "1";',
    '',
    '    private static readonly Dictionary<string, string> Values = new()',
    '    {',
    ...uniq.map(([k, v]) => `        ["${esc(k)}"] = "${esc(v)}",`),
    '    };',
    '',
    '    /// <summary>Carga appsettings.AI.json y rellena las claves vacías. No pisa valores existentes.</summary>',
    '    public static IConfigurationBuilder AddAiEnv(this IConfigurationBuilder builder)',
    '    {',
    '        if (!IsAiEnv)',
    '        {',
    '            return builder;',
    '        }',
    '',
    '        builder.AddJsonFile("appsettings.AI.json", optional: true, reloadOnChange: false);',
    '        var config = builder.Build();',
    '        var missing = new Dictionary<string, string?>();',
    '        foreach (var pair in Values)',
    '        {',
    '            if (string.IsNullOrWhiteSpace(config[pair.Key]))',
    '            {',
    '                missing[pair.Key] = pair.Value;',
    '            }',
    '        }',
    '',
    '        return missing.Count == 0 ? builder : builder.AddInMemoryCollection(missing);',
    '    }',
    '',
    '    /// <summary>Valor obligatorio: vacío sin AI_ENV → error claro con el nombre de la clave.</summary>',
    '    public static string Require(IConfiguration config, string key)',
    '    {',
    '        var value = config[key];',
    '        if (!string.IsNullOrWhiteSpace(value))',
    '        {',
    '            return value;',
    '        }',
    '',
    '        throw new InvalidOperationException(',
    '            $"[bot-secure] Falta la clave \'{key}\'. En el ambiente de IA viene de appsettings.AI.json " +',
    '            "(AI_ENV=1 dotnet run); en dev/qa/prd, del entorno o del gestor de secretos.");',
    '    }',
    '}',
    '',
  ].join('\n');
}

const PROGRAM_SNIPPET = [
  'var builder = WebApplication.CreateBuilder(args);',
  '',
  '// bot-secure: appsettings.AI.json SOLO con AI_ENV=1. El entorno sigue siendo Development.',
  'builder.Configuration.AddAiEnv();',
  '',
  'var app = builder.Build();',
  '',
  '// En el ambiente de IA no se exponen Swagger ni la página de errores de desarrollo.',
  'if (app.Environment.IsDevelopment() && !BotSecure.AiEnv.IsAiEnv)',
  '{',
  '    app.UseDeveloperExceptionPage();',
  '    app.UseSwagger();',
  '    app.UseSwaggerUI();',
  '}',
].join('\n');

export function runCmdAi() { return 'AI_ENV=1 dotnet run'; }

export function loaderSnippet() { return { file: 'Program.cs', lang: 'csharp', code: PROGRAM_SNIPPET }; }

export function files(app, policy, ctx = {}) {
  const c = aiContext(app, policy, ctx);
  return [
    file(app, 'appsettings.AI.json', appsettingsAi(c)),
    file(app, 'AiEnv.cs', aiEnvCs(c)),
  ];
}

export function docs(app) {
  return docsBlock({
    title: `.NET (${app?.name ?? 'backend'})`,
    runCmd: 'AI_ENV=1 dotnet run',
    files: ['appsettings.AI.json', 'AiEnv.cs', 'Program.cs (fragmento manual, abajo)'],
    notes: [
      '`AI_ENV` es una bandera ortogonal: `ASPNETCORE_ENVIRONMENT` sigue siendo `Development`.',
      'En `ai-dev`, `appsettings.json` deja `"ConnectionStrings": { "Default": "" }`.',
      '`AiEnv.Require(config, "clave")` convierte un vacío sin `AI_ENV` en un error con el nombre de la clave.',
    ],
    snippet: loaderSnippet(app),
  });
}

export default { id, files, loaderSnippet, runCmdAi, docs };
