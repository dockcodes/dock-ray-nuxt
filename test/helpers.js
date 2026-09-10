import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';

/**
 * Test doubles shared by the suite.
 *
 * Nothing here talks to a real Nuxt build or to dockray.io: a module is run
 * against a plain object standing in for `nuxt`, and reports go to a throwaway
 * HTTP server on loopback so the payload can be read exactly as the panel
 * would receive it.
 */

/**
 * Runs `body` against a stand-in panel and hands it the URL plus the list of
 * requests the panel received, gunzipped and parsed.
 */
export async function withPanel(run) {
    const received = [];
    const server = createServer((req, res) => {
        const chunks = [];

        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            const body = req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;

            received.push({ path: req.url, payload: JSON.parse(body.toString('utf8')) });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
        await run(`http://127.0.0.1:${server.address().port}`, received);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

export function fakeNitro() {
    const hooks = new Map();

    return {
        hooks: { hook: (name, fn) => hooks.set(name, fn) },
        fire: (name, ...args) => hooks.get(name)?.(...args),
        has: (name) => hooks.has(name),
    };
}

/**
 * A client that records instead of reporting, for the tests that care about
 * what the hooks decided rather than about the wire format.
 */
export function recordingRay({ enabled = true } = {}) {
    const calls = { exceptions: [], transactions: [], closed: 0 };

    return {
        calls,
        enabled,
        report: (value) => value,
        captureException: (error, options) => calls.exceptions.push({ error, options }),
        captureTransaction: (options) => calls.transactions.push(options),
        close: () => (calls.closed += 1),
    };
}

/** A Node-side H3 event, the shape Nitro passes on a server with a socket. */
export function h3Event({ path = '/orders/8123', method = 'GET', status = 200, matched = '/orders/:id', headers = {} } = {}) {
    return {
        path,
        method,
        context: matched ? { matchedRoute: { path: matched } } : {},
        node: {
            req: {
                method,
                url: path,
                headers: {
                    host: 'shop.test',
                    'user-agent': 'Firefox/130',
                    'x-forwarded-for': '203.0.113.7, 10.0.0.1',
                    cookie: 'session=secret',
                    authorization: 'Bearer nope',
                    ...headers,
                },
                socket: { remoteAddress: '10.0.0.1' },
            },
            res: { statusCode: status },
        },
    };
}

/**
 * The same request as it arrives on a worker: no `event.node`, a Fetch
 * `Request` in its place and `Headers` rather than a plain object.
 */
export function workerEvent({ path = '/orders/8123', method = 'get', headers = {} } = {}) {
    return {
        path,
        method,
        web: {
            request: {
                headers: new Headers({
                    host: 'shop.test',
                    'user-agent': 'Firefox/130',
                    cookie: 'session=secret',
                    ...headers,
                }),
            },
        },
    };
}

/**
 * Enough of a Nuxt instance for `defineNuxtModule` to run a setup against:
 * the version the compatibility check reads, the option buckets the `add*`
 * helpers push into, and the config key the module is configured under.
 */
export function fakeNuxt({ ray = {}, runtimeConfig = {} } = {}) {
    return {
        _version: '4.0.0',
        options: {
            ray,
            runtimeConfig: { public: {}, ...runtimeConfig },
            plugins: [],
            serverHandlers: [],
            nitro: {},
            experimental: {},
        },
        hooks: { hook() {}, addHooks() {} },
        callHook: async () => {},
    };
}
