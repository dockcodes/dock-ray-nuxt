# @dockcodes/dock-ray-nuxt

Nuxt module for [DockRay](https://dockray.io). Reports server errors, request
timings, Vue component errors and — optionally — JavaScript errors from the
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
runtime config only — everything under `runtimeConfig.public` is serialised
into the client bundle, and a project key there is a published key. Without a
token and a key the module loads and sends nothing.

## Options

| Option | Default | Meaning |
|---|---|---|
| `environment` | `NODE_ENV` | environment column in the panel |
| `release` | — | deployed version |
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
written — nothing is sent while the visitor is waiting. They are named after
the matched route (`GET /orders/:id`), so one route stays one row in the panel
no matter how many identifiers pass through it.

`createError({ statusCode: 404 })` and every other `4xx` is the caller getting
it wrong, not the app failing, so only `5xx` is reported.

The same code runs on Node and on workers: the event is read through both
`event.node.req` and the Fetch `Request` shape, so a Cloudflare or Vercel Edge
deployment needs no second code path.

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
in the envelope — environment, release, timestamp — so a browser cannot choose
which environment its errors land in.

Vue swallows component errors into its own handler, so `window.onerror` never
sees them. The plugin wires both Nuxt hooks: `vue:error` for render and
lifecycle failures, `app:error` for a fatal boot.

The route answers `202` to everything — valid, malformed, rate-limited — so a
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
