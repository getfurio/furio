import { z } from 'zod';

export const SCHEMA_VERSION = 1;
export const SCHEMA_ID = 'https://getfurio.com/schema/v1.json';

/** Accepted manifest file names inside `.architecture/`, canonical first. */
export const MANIFEST_FILE_NAMES = ['architecture.yaml', 'furio.yaml'] as const;
export const ARCHITECTURE_DIR = '.architecture';

export const COMPONENT_TYPES = [
  'service',
  'function',
  'job',
  'frontend',
  'queue',
  'topic',
  'database',
  'cache',
  'storage',
  'external',
  'client',
  'proxy',
  'domain',
] as const;

export const RELATION_TYPES = [
  'calls',
  'publishes',
  'consumes',
  'reads',
  'writes',
  'reads_writes',
  'serves',
  'spawns',
  'depends_on',
] as const;

export const COMPONENT_STATUSES = ['active', 'deprecated', 'dev-only'] as const;

/**
 * Technologies Furio knows by name, for "Did you mean" on `tech`. Any lowercase value is valid:
 * the list only catches typos. Aliases are listed so they are not flagged.
 */
export const KNOWN_TECH: readonly string[] = [
  // languages and runtimes
  'node deno bun python go java kotlin scala ruby php rust dotnet csharp elixir erlang swift',
  'typescript javascript',
  // frameworks
  'fastify express nestjs hono nextjs nuxt remix react vue svelte sveltekit angular astro vite',
  'django flask fastapi rails laravel symfony spring quarkus phoenix',
  // desktop and mobile
  'tauri electron react-native flutter ios android macos windows',
  // data
  'mysql mariadb postgres postgresql sqlite mongodb mongo redis valkey memcached elasticsearch',
  'opensearch clickhouse cassandra dynamodb firestore supabase timescaledb duckdb questdb influxdb',
  // messaging and storage
  'kafka rabbitmq nats sqs sns eventbridge pubsub redis-streams s3 r2 gcs minio',
  // serving and infrastructure
  'nginx caddy traefik haproxy envoy apache cloudflare cloudfront docker kubernetes k8s systemd',
  'lambda cloud-run ecs fargate vercel netlify fly heroku github-actions route53 letsencrypt',
  // third-party services
  'stripe brevo sendgrid mailgun postmark twilio auth0 clerk github google openai anthropic',
  'deepseek sentry datadog grafana prometheus',
].flatMap((line) => line.split(' '));

export const DIAGRAM_EXTENSIONS = ['.mmd', '.md'] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];
export type RelationType = (typeof RELATION_TYPES)[number];
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

/** kebab-case: lowercase letters and digits, single dashes between them. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `component` (same project) or `project/component` (any project of the workspace). */
export const REF_PATTERN = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Dotted provider name, e.g. `aws.sqs`, `gcp.pubsub`, `stripe`. */
export const PROVIDER_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
/** A folder of the repo: relative, forward slashes, no `..`, e.g. `apps/server`. */
export const PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\0]+$/;

const slug = (what: string, example: string) =>
  z
    .string()
    .regex(SLUG_PATTERN, { error: `${what} must be kebab-case, e.g. "${example}"` })
    .max(64);

const ref = z
  .string()
  .regex(REF_PATTERN, {
    error: 'references are "component" or "project/component", both kebab-case',
  })
  .meta({
    description: 'A component id in this project, or "project/component" for another project.',
  });

const provider = z
  .string()
  .regex(PROVIDER_PATTERN, { error: 'providers are lowercase and dotted, e.g. "aws.sqs"' })
  .meta({
    description: 'Where it runs or who provides it, e.g. "aws.sqs", "gcp.pubsub", "stripe".',
  });

export const ComponentSchema = z
  .strictObject({
    id: slug('component ids', 'payments-api').meta({
      description: 'Unique within the project, kebab-case.',
    }),
    type: z.enum(COMPONENT_TYPES).meta({ description: 'What kind of component this is.' }),
    name: z.string().min(1).optional().meta({ description: 'Human-readable name.' }),
    description: z.string().optional(),
    owner: z.string().min(1).optional().meta({
      description: 'Team responsible for this component. Defaults to the manifest owner.',
    }),
    provider: provider.optional(),
    runtime: provider.optional().meta({ description: 'Runtime platform, e.g. "aws.ecs".' }),
    tech: z
      .string()
      .regex(PROVIDER_PATTERN, { error: 'tech is lowercase, e.g. "postgres", "node", "nginx"' })
      .optional()
      .meta({
        description:
          'The concrete technology, e.g. "postgres", "redis", "node", "nginx", "tauri". Free text, lowercase.',
      }),
    path: z
      .string()
      .regex(PATH_PATTERN, {
        error: 'path is a folder of the repo, relative and without "..", e.g. "apps/server"',
      })
      .max(300)
      .optional()
      .meta({ description: 'Folder of this component in the repo, e.g. "apps/server".' }),
    host: provider.optional().meta({
      description:
        'Where it runs: a machine, a cluster, a region, e.g. "customer-machine", "vps-1", "aws.eu-west-1".',
    }),
    status: z.enum(COMPONENT_STATUSES).optional().meta({
      description:
        'active (the default), deprecated (still running, on its way out) or dev-only (CI, local tools).',
    }),
    tags: z.array(z.string().min(1)).optional(),
    links: z
      .record(z.string().min(1), z.url({ protocol: /^https?$/ }))
      .optional()
      .meta({ description: 'Named links, e.g. docs, dashboard, runbook.' }),
  })
  .meta({ title: 'Component' });

export const RelationSchema = z
  .strictObject({
    from: slug('component ids', 'payments-api').meta({
      description: 'A component declared in this manifest.',
    }),
    to: ref,
    type: z.enum(RELATION_TYPES),
    protocol: z.string().min(1).optional().meta({ description: 'e.g. http, grpc, amqp.' }),
    description: z.string().optional(),
  })
  .meta({ title: 'Relation' });

export const DiagramSchema = z
  .strictObject({
    file: z.string().min(1).meta({
      description:
        'Path relative to .architecture/: a .mmd file, or a .md file with ```mermaid blocks.',
    }),
    title: z.string().min(1),
    components: z
      .array(ref)
      .optional()
      .meta({ description: 'Components this diagram describes; it shows up on their pages.' }),
  })
  .meta({ title: 'Diagram' });

export const ManifestSchema = z
  .strictObject({
    version: z.literal(SCHEMA_VERSION).meta({ description: 'Manifest schema version.' }),
    project: slug('project ids', 'my-shop').meta({
      description: 'The software this repo belongs to. Several repos can share one project.',
    }),
    owner: z
      .string()
      .min(1)
      .optional()
      .meta({ description: 'Default owner (team) for every component in this manifest.' }),
    closed: z.boolean().optional().meta({
      description:
        'True when this repo is the whole project: a reference to a component of the same project that this manifest does not declare is an error, not a ghost.',
    }),
    components: z.array(ComponentSchema).default([]),
    relations: z.array(RelationSchema).default([]),
    diagrams: z.array(DiagramSchema).default([]),
  })
  .meta({
    title: 'Furio architecture manifest',
    description: 'Describes the part of the architecture owned by this repo. https://getfurio.com',
  });

export type Component = z.infer<typeof ComponentSchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type Diagram = z.infer<typeof DiagramSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestInput = z.input<typeof ManifestSchema>;

/** JSON Schema of the manifest, for editor autocompletion (e.g. the YAML language server). */
export function manifestJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ManifestSchema, { target: 'draft-2020-12', io: 'input' });
  const { $schema, ...rest } = schema;
  return { $schema, $id: SCHEMA_ID, ...rest };
}
