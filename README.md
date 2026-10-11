# @dockcodes/dock-ray-nuxt

Nuxt module for [DockRay](https://dockray.io). Reports server errors, request
timings, Vue component errors and - optionally - JavaScript errors from the
browser. Works with Nuxt 3 and 4.

## Installation

```bash
npm install @dockcodes/dock-ray-nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    modules: ['@dockcodes/dock-ray-nuxt'],

    ray: {
        tracesSampleRate: 0.2,
        browser: { enabled: false },
    },
});
```

```dotenv
NUXT_RAY_TOKEN=project-token
NUXT_RAY_PRIVATE_KEY=project-private-key
```

Nuxt maps `NUXT_RAY_*` onto `runtimeConfig.ray`, so credentials stay out of
`nuxt.config.ts` and out of git. The module puts them in the **private**
runtime config only - everything under `runtimeConfig.public` is serialised
into the client bundle, and a project key there is a published key. Without a
token and a key the module loads and sends nothing.

## Options

| Option | Default | Meaning |
|---|---|---|
| `environment` | `RAY_ENVIRONMENT`, `VERCEL_ENV`, `NODE_ENV`, then production | environment shared by errors and inventory |
| `release` | - | deployed version |
| `inventoryEnabled` | off (unset) | opt-in Node SDK package reporting; explicit false overrides RAY_INVENTORY |
| `inventoryExcludePackages` | `[]` | package names/globs to exclude |
| `inventoryProjectDirectory` | application working directory | original npm metadata and installed production node_modules |
| `inventoryStateDirectory` | private system temporary directory | private persistent state for locks, hashes and retry timing |
| `sampleRate` | `1` | share of error events sent |
| `tracesSampleRate` | `0` | share of transactions sent; `0` disables tracing |
| `sendDefaultPii` | `false` | attach IP address and user agent |
| `ignorePaths` | `['/_nuxt', '/__nuxt', '/health', '/metrics']` | paths never measured |
| `browser.enabled` | `false` | collect JavaScript errors |
| `browser.endpoint` | `/api/_ray/browser` | route that receives them |
| `browser.sampleRate` | `1` | share of browser errors reported |

## What the server reports

The module registers a Nitro plugin on three hooks:

| Hook | Does |
|---|---|
| `request` | stamps the start time |
| `error` | reports unhandled server errors, tagged with the matched route |
| `afterResponse` | closes the transaction with the response status |
| `close` | flushes queued reports before the process ends |

Transactions go out on `afterResponse`, which fires once the reply has been
written - nothing is sent while the visitor is waiting. They are named after
the matched route (`GET /orders/:id`), so one route stays one row in the panel
no matter how many identifiers pass through it.

`createError({ statusCode: 404 })` and every other `4xx` is the caller getting
it wrong, not the app failing, so only `5xx` is reported.

The full SDK used by this module requires a Node.js Nitro server. Request
description supports both H3 and Fetch shapes, but this does not make the Node
SDK compatible with Cloudflare Workers or other Edge runtimes. Inventory is
not available in the browser, Edge or static-only deployments.

## Package inventory and vulnerability alerts

Version 1.1.0 requires Node SDK `@dockcodes/dock-ray` 1.1.1+ and a DockRay API
with explicit inventory environment support. Inventory is off until enabled.
Use the existing module configuration:

```ts
export default defineNuxtConfig({
    modules: ['@dockcodes/dock-ray-nuxt'],
    ray: {
        inventoryEnabled: true,
        environment: 'production',
        inventoryExcludePackages: ['@company/*'],
        // Optional: original deployment root with npm lockfile and node_modules.
        // inventoryProjectDirectory: '/srv/my-app',
        // Optional: persistent state outside public assets, writable only by the app.
        // inventoryStateDirectory: '/var/lib/my-app/dockray-inventory',
    },
});
```

Or configure these **private runtime** environment variables:

```dotenv
NUXT_RAY_TOKEN=project-token
NUXT_RAY_PRIVATE_KEY=project-private-key
NUXT_RAY_INVENTORY_ENABLED=true
NUXT_RAY_ENVIRONMENT=production
# Optional JSON array of exclusions:
# NUXT_RAY_INVENTORY_EXCLUDE_PACKAGES=["@company/*"]
# NUXT_RAY_INVENTORY_PROJECT_DIRECTORY=/srv/my-app
# NUXT_RAY_INVENTORY_STATE_DIRECTORY=/var/lib/my-app/dockray-inventory
```

Nuxt maps these onto private runtimeConfig.ray at runtime; see the
[Nuxt runtime configuration guide](https://nuxt.com/docs/4.x/guide/going-further/runtime-config).
When the corresponding module/runtime option is unset, the client also accepts
`RAY_INVENTORY=true`, `RAY_ENVIRONMENT`, `RAY_INVENTORY_EXCLUDE_PACKAGES`
(comma-separated), `RAY_INVENTORY_PROJECT_DIR` and `RAY_INVENTORY_STATE_DIR`.
Explicit `inventoryEnabled: false` or `NUXT_RAY_INVENTORY_ENABLED=false` wins
over `RAY_INVENTORY`. Do not put inventory options or credentials in public
runtime config or variables prefixed with NUXT_PUBLIC_. No site URL is configured
or sent. `prod`/`production` become `prod`; `dev`/`development`/`staging`/`preview`/
`test`/`local` become `dev`. Unknown values fail without sending a report.
Development requires a configured development environment in the DockRay project.

The module initializes one SDK client when Nitro starts. The SDK checks in the
background after startup, then hourly; changes are sent on the next check and
unchanged inventory is refreshed approximately every 12 hours. Requests reuse
the client. Nitro close and reset stop the timers and await pending reports.
Prerendering never starts inventory. The SDK's locks, retry backoff and server
limits apply to manual reports as well. Production and development have separate
package snapshots and state.

Only installed production npm packages are collected using package-lock.json or
npm-shrinkwrap.json v2/v3. The report contains package names/versions,
normalized environment and Node/SDK versions, without source code, credentials,
environment files or user data. Exclusions can hide private package names.
Nuxt, Vue and their dependencies are included only when installed as production
packages; devDependencies are excluded. Reports appear as Node.js in the project
Software tab, with known npm vulnerabilities matched by existing DockRay alerts.

**Deployment:** Nuxt's standalone `.output` directory alone is insufficient for
this collector. Preserve the original npm lockfile, package.json and installed
production node_modules and point inventoryProjectDirectory at that root.
Yarn, pnpm, workspaces and npm lockfile v1 are not supported. Collection failures
send no partial or empty snapshot and do not clear existing vulnerability findings.

On serverless/Vercel, timers and temporary state cannot guarantee a recurring
schedule. Use a separate scheduled Node process with the Node SDK's
`dockray-inventory` command, original installed npm metadata and persistent
private state. That command uses RAY_TOKEN, RAY_PRIVATE_KEY, RAY_INVENTORY and
RAY_ENVIRONMENT (not the NUXT-prefixed names). Run it hourly; do not expose an
unauthenticated HTTP endpoint to trigger reports.

A trusted Nitro server task can reuse the client for an immediate report:

```js
import { useRuntimeConfig } from '#imports';
import { useRay } from '@dockcodes/dock-ray-nuxt/runtime/server/client.js';

const result = await useRay(useRuntimeConfig().ray).reportInventory({ force: true });
```

This still respects retry backoff and backend limits. Keep this code server-side.

## JavaScript errors

Off by default:

```ts
ray: {
    browser: { enabled: true },
}
```

That registers the Nitro route and a client plugin. The browser reports to
**your app**, never to the panel: it holds no project key, and giving it one
would publish it. The server forwards each report with its own key and fills
in the envelope - environment, release, timestamp - so a browser cannot choose
which environment its errors land in.

Vue swallows component errors into its own handler, so `window.onerror` never
sees them. The plugin wires both Nuxt hooks: `vue:error` for render and
lifecycle failures, `app:error` for a fatal boot.

The route answers `202` to everything - valid, malformed, rate-limited - so a
caller learns nothing about the guards. It drops bodies over 16 KB and allows
20 reports per address per minute, counting every attempt including junk. The
collector caps itself too: one report per distinct error per page view, ten per
page view by default, with `ResizeObserver loop` and cross-origin
`Script error.` filtered out.

From your own code:

```js
window.DockRay?.captureException(error);
window.DockRay?.captureMessage('Checkout step skipped');
```

## What is reported and what is not

`Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key` and the collector's own
token are stripped from reported headers. The visitor's IP address and user
agent are attached only when `sendDefaultPii` is on; without it a report
carries no `user` at all. The client address is read from `X-Forwarded-For` or
`X-Real-IP` before the socket address.

## Tests

```bash
npm test
```

## License

MIT.
