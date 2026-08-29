import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

import { DockThorClient } from '@dockcodes/dock-thor';
import { registerThorHooks } from '../src/runtime/server/nitro.js';
import { createRateLimiter, forwardBrowserReport } from '../src/runtime/server/browser.js';
import { addressOf, describeEvent, routeNameFor, shouldIgnore } from '../src/runtime/server/request.js';

async function withPanel(run) {
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

function fakeNitro() {
    const hooks = new Map();

    return {
        hooks: { hook: (name, fn) => hooks.set(name, fn) },
        fire: (name, ...args) => hooks.get(name)?.(...args),
        has: (name) => hooks.has(name),
    };
}

function h3Event({ path = '/orders/8123', method = 'GET', status = 200, matched = '/orders/:id' } = {}) {
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
                },
                socket: { remoteAddress: '10.0.0.1' },
            },
            res: { statusCode: status },
        },
    };
}

test('the module never puts credentials in the public runtime config', () => {
    const module = readFileSync(new URL('../src/module.js', import.meta.url), 'utf8');
    const publicBlock = module.slice(module.indexOf('runtimeConfig.public.thor'));

    for (const secret of ['privateKey', 'token']) {
        assert.equal(publicBlock.includes(secret), false, `${secret} must not reach the client bundle`);
    }
});

test('the client plugin never imports the node client', () => {
    for (const file of readdirSync(new URL('../src/runtime/plugins/', import.meta.url))) {
        const source = readFileSync(new URL(`../src/runtime/plugins/${file}`, import.meta.url), 'utf8');

        assert.deepEqual([...source.matchAll(/from '(node:[^']+)'/g)], []);
        assert.equal(source.includes("from '@dockcodes/dock-thor'"), false);
    }
});

test('describes an H3 event without leaking secrets', () => {
    const described = describeEvent(h3Event());

    assert.equal(described.http.url, 'http://shop.test/orders/8123');
    assert.equal(described.http.method, 'GET');
    assert.equal(described.http.headers.cookie, undefined);
    assert.equal(described.http.headers.authorization, undefined);
    assert.equal(described.user.ip_address, '203.0.113.7');
    assert.equal(addressOf(h3Event()), '203.0.113.7');
});

test('a transaction is named after the matched route, not the path', () => {
    assert.equal(routeNameFor(h3Event()), 'GET /orders/:id');
    assert.equal(routeNameFor(h3Event({ matched: null })), 'GET /orders/8123');
});

test('ignored paths stay out of the panel', () => {
    assert.equal(shouldIgnore(h3Event({ path: '/_nuxt/entry.js' }), ['/_nuxt']), true);
    assert.equal(shouldIgnore(h3Event(), ['/_nuxt']), false);
});

test('the transaction is reported on afterResponse, not during the request', async () => {
    await withPanel(async (url, received) => {
        const thor = new DockThorClient({ token: 'tok', privateKey: 'key', url, tracesSampleRate: 1 });
        const nitro = fakeNitro();

        registerThorHooks(nitro, thor, { ignorePaths: ['/_nuxt'] });

        const event = h3Event({ status: 201 });

        nitro.fire('request', event);
        await thor.flush();

        assert.equal(received.length, 0, 'nothing goes out while the request is being handled');

        nitro.fire('afterResponse', event);
        await thor.flush();

        assert.equal(received.length, 1);
        assert.equal(received[0].path, '/api/v1/tok/transaction');
        assert.equal(received[0].payload.transaction, 'GET /orders/:id');
        assert.equal(received[0].payload.tags['http.status_code'], '201');
        assert.deepEqual(received[0].payload.contexts.trace.data, {
            url: 'http://shop.test/orders/8123',
            method: 'GET',
        });
    });
});

test('server faults are reported and expected 4xx are not', async () => {
    await withPanel(async (url, received) => {
        const thor = new DockThorClient({ token: 'tok', privateKey: 'key', url });
        const nitro = fakeNitro();

        registerThorHooks(nitro, thor, {});

        nitro.fire('error', Object.assign(new Error('not found'), { statusCode: 404 }), { event: h3Event() });
        await thor.flush();

        assert.equal(received.length, 0, 'a 404 is the caller getting it wrong');

        nitro.fire('error', new Error('database is down'), { event: h3Event() });
        await thor.flush();

        assert.equal(received.length, 1);
        assert.equal(received[0].payload.exception.values[0].value, 'database is down');
        assert.equal(received[0].payload.tags.route, 'GET /orders/:id');
    });
});

test('hooks are not registered at all without credentials', () => {
    const nitro = fakeNitro();

    registerThorHooks(nitro, new DockThorClient(), {});

    assert.equal(nitro.has('request'), false);
    assert.equal(nitro.has('afterResponse'), false);
});

test('a browser report is forwarded with a server-side envelope', async () => {
    await withPanel(async (url, received) => {
        const thor = new DockThorClient({ token: 'tok', privateKey: 'key', url, environment: 'production' });

        const accepted = forwardBrowserReport(thor, {
            body: JSON.stringify({ type: 'TypeError', message: 'null is not an object' }),
            headers: { referer: 'https://shop.test/cart', 'user-agent': 'Firefox/130' },
            address: '203.0.113.7',
        });

        assert.equal(accepted, true);
        await thor.flush();

        assert.equal(received[0].payload.platform, 'javascript');
        assert.equal(received[0].payload.tags.source, 'browser');
        assert.equal(received[0].payload.environment, 'production');
    });
});

test('oversized, malformed and flooding reports are refused', async () => {
    await withPanel(async (url, received) => {
        const thor = new DockThorClient({ token: 'tok', privateKey: 'key', url });
        const post = (body, limiter) => forwardBrowserReport(thor, { body, address: '203.0.113.7', limiter });

        assert.equal(post(JSON.stringify({ message: 'x'.repeat(20000) })), false, 'over 16 KB');
        assert.equal(post('not json'), false, 'malformed');
        assert.equal(post(''), false, 'empty');

        await thor.flush();
        assert.equal(received.length, 0, 'none of those reach the panel');

        const limiter = createRateLimiter({ limit: 2 });

        assert.equal(post(JSON.stringify({ message: 'a' }), limiter), true);
        assert.equal(post(JSON.stringify({ message: 'b' }), limiter), true);
        assert.equal(post(JSON.stringify({ message: 'c' }), limiter), false, 'past the window limit');

        await thor.flush();
        assert.equal(received.length, 2);
    });
});

test('a flood of malformed bodies is rate limited too', () => {
    const thor = new DockThorClient({ token: 'tok', privateKey: 'key', url: 'http://127.0.0.1:1' });
    const limiter = createRateLimiter({ limit: 2 });
    const post = () => forwardBrowserReport(thor, { body: 'not json', address: '203.0.113.7', limiter });

    post();
    post();

    /*
     | The counter is spent whether or not the body parsed: rate limiting
     | exists to cap the requests, and junk costs the same to receive.
     */
    assert.equal(limiter.allow('203.0.113.7'), false);
});
