import assert from 'node:assert/strict';
import test from 'node:test';

import { DockRayClient } from '@dockcodes/dock-ray';

import { registerRayHooks } from '../src/runtime/server/nitro.js';
import { fakeNitro, h3Event, recordingRay, withPanel } from './helpers.js';

test('the transaction is reported on afterResponse, not during the request', async () => {
    await withPanel(async (url, received) => {
        const ray = new DockRayClient({ token: 'tok', privateKey: 'key', url, tracesSampleRate: 1 });
        const nitro = fakeNitro();

        registerRayHooks(nitro, ray, { ignorePaths: ['/_nuxt'] });

        const event = h3Event({ status: 201 });

        nitro.fire('request', event);
        await ray.flush();

        assert.equal(received.length, 0, 'nothing goes out while the request is being handled');

        nitro.fire('afterResponse', event);
        await ray.flush();

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
        const ray = new DockRayClient({ token: 'tok', privateKey: 'key', url });
        const nitro = fakeNitro();

        registerRayHooks(nitro, ray, {});

        nitro.fire('error', Object.assign(new Error('not found'), { statusCode: 404 }), { event: h3Event() });
        await ray.flush();

        assert.equal(received.length, 0, 'a 404 is the caller getting it wrong');

        nitro.fire('error', new Error('database is down'), { event: h3Event() });
        await ray.flush();

        assert.equal(received.length, 1);
        assert.equal(received[0].payload.exception.values[0].value, 'database is down');
        assert.equal(received[0].payload.tags.route, 'GET /orders/:id');
    });
});

test('a 500 carried on the error is a fault, however it is spelled', () => {
    const ray = recordingRay();
    const nitro = fakeNitro();

    registerRayHooks(nitro, ray, {});

    nitro.fire('error', Object.assign(new Error('gateway'), { status: 502 }), { event: h3Event() });
    nitro.fire('error', Object.assign(new Error('teapot'), { status: 418 }), { event: h3Event() });
    nitro.fire('error', new Error('no status at all'), { event: h3Event() });

    assert.deepEqual(ray.calls.exceptions.map(({ error }) => error.message), ['gateway', 'no status at all']);
});

test('an error raised outside a request is still reported, without a route', () => {
    const ray = recordingRay();
    const nitro = fakeNitro();

    registerRayHooks(nitro, ray, {});

    nitro.fire('error', new Error('a scheduled task failed'));

    assert.equal(ray.calls.exceptions.length, 1);
    assert.deepEqual(ray.calls.exceptions[0].options.tags, {});
    assert.equal(ray.calls.exceptions[0].options.request, undefined);
});

test('an ignored path silences the transaction but never a fault', () => {
    const ray = recordingRay();
    const nitro = fakeNitro();
    const event = h3Event({ path: '/_nuxt/entry.js', matched: null });

    registerRayHooks(nitro, ray, { ignorePaths: ['/_nuxt'] });

    nitro.fire('request', event);
    nitro.fire('afterResponse', event);
    nitro.fire('error', new Error('the asset handler threw'), { event });

    assert.deepEqual(ray.calls.transactions, []);
    assert.equal(ray.calls.exceptions.length, 1);
});

test('the transaction spans the request, and keeps whatever context was there', () => {
    const ray = recordingRay();
    const nitro = fakeNitro();
    const event = h3Event({ status: 201 });

    event.context.session = 'left alone';

    registerRayHooks(nitro, ray, {});
    nitro.fire('request', event);

    const startedAt = event.context.rayStartedAt;

    assert.equal(typeof startedAt, 'number');
    assert.equal(event.context.session, 'left alone');
    assert.equal(event.context.matchedRoute.path, '/orders/:id');

    nitro.fire('afterResponse', event);

    const [transaction] = ray.calls.transactions;

    assert.equal(transaction.name, 'GET /orders/:id');
    assert.equal(transaction.statusCode, 201);
    assert.equal(transaction.startTimestamp, startedAt);
    assert.ok(transaction.endTimestamp >= startedAt, 'the window ends no earlier than it began');
});

test('a response that never went through the request hook is not timed', () => {
    const ray = recordingRay();
    const nitro = fakeNitro();

    registerRayHooks(nitro, ray, {});
    nitro.fire('afterResponse', h3Event());

    assert.deepEqual(ray.calls.transactions, [], 'without a start there is nothing to measure');
});

test('a status code is assumed only when the response has none', () => {
    const ray = recordingRay();
    const nitro = fakeNitro();
    const event = { path: '/orders', context: {} };

    registerRayHooks(nitro, ray, {});
    nitro.fire('request', event);
    nitro.fire('afterResponse', event);

    assert.equal(ray.calls.transactions[0].statusCode, 200);
});

test('tracing off means no transactions leave the process', async () => {
    await withPanel(async (url, received) => {
        const ray = new DockRayClient({ token: 'tok', privateKey: 'key', url, tracesSampleRate: 0 });
        const nitro = fakeNitro();
        const event = h3Event();

        registerRayHooks(nitro, ray, {});

        nitro.fire('request', event);
        nitro.fire('afterResponse', event);
        await ray.flush();

        assert.deepEqual(received, []);
    });
});

test('shutting Nitro down closes the client so pending reports are flushed', () => {
    const ray = recordingRay();
    const nitro = fakeNitro();

    registerRayHooks(nitro, ray, {});
    nitro.fire('close');

    assert.equal(ray.calls.closed, 1);
});

test('hooks are not registered at all without credentials', () => {
    const nitro = fakeNitro();

    registerRayHooks(nitro, new DockRayClient(), {});

    assert.equal(nitro.has('request'), false);
    assert.equal(nitro.has('afterResponse'), false);
    assert.equal(nitro.has('error'), false);
    assert.equal(nitro.has('close'), false);
});

test('the visitor is attached only when sendDefaultPii is on', async () => {
    await withPanel(async (url, received) => {
        const shy = new DockRayClient({ token: 'tok', privateKey: 'key', url });
        const telling = new DockRayClient({ token: 'tok', privateKey: 'key', url, sendDefaultPii: true });

        for (const ray of [shy, telling]) {
            const nitro = fakeNitro();

            registerRayHooks(nitro, ray, {});
            nitro.fire('error', new Error('database is down'), { event: h3Event() });
            await ray.flush();
        }

        assert.equal(received[0].payload.user?.ip_address, undefined, 'no PII by default');
        assert.equal(received[0].payload.user?.agent, undefined);
        assert.equal(received[1].payload.user.ip_address, '203.0.113.7');
        assert.equal(received[1].payload.user.agent, 'Firefox/130');
    });
});
