import assert from 'node:assert/strict';
import test from 'node:test';

import { addressOf, describeEvent, headersOf, routeNameFor, shouldIgnore } from '../src/runtime/server/request.js';
import { h3Event, workerEvent } from './helpers.js';

test('describes an H3 event without leaking secrets', () => {
    const described = describeEvent(h3Event());

    assert.equal(described.http.url, 'http://shop.test/orders/8123');
    assert.equal(described.http.method, 'GET');
    assert.equal(described.http.headers.cookie, undefined);
    assert.equal(described.http.headers.authorization, undefined);
    assert.equal(described.user.ip_address, '203.0.113.7');
    assert.equal(addressOf(h3Event()), '203.0.113.7');
});

test('every credential-bearing header is dropped, whatever its casing', () => {
    const described = describeEvent(h3Event({
        headers: {
            'Set-Cookie': 'session=secret',
            'X-Api-Key': 'nope',
            'X-DockRay-Token': 'nope',
            'X-Request-Id': 'req-7',
        },
    }));

    assert.deepEqual(Object.keys(described.http.headers).sort(), [
        'host',
        'user-agent',
        'x-forwarded-for',
        'x-request-id',
    ]);
});

test('the same request is read on a worker, where there is no event.node', () => {
    const described = describeEvent(workerEvent({ method: 'post' }));

    assert.equal(described.http.url, 'http://shop.test/orders/8123');
    assert.equal(described.http.method, 'POST');
    assert.equal(described.http.headers['user-agent'], 'Firefox/130');
    assert.equal(described.http.headers.cookie, undefined);
    assert.deepEqual(described.user, { agent: 'Firefox/130' });
});

test('headers arriving as a plain object are lowercased, and non-strings are left out', () => {
    const headers = headersOf({ headers: { Host: 'shop.test', 'Content-Length': 12, Cookie: 'session=secret' } });

    assert.deepEqual(headers, { host: 'shop.test', cookie: 'session=secret' });
});

test('an event with nothing on it still describes cleanly', () => {
    const described = describeEvent({});

    assert.equal(described.http.url, 'http://localhost/');
    assert.equal(described.http.method, 'GET');
    assert.deepEqual(described.http.headers, {});
    assert.equal(described.user, undefined, 'an empty user block is dropped, not sent half-filled');
});

test('the scheme comes from the proxy header, or from the socket behind it', () => {
    const behindProxy = { path: '/x', node: { req: { headers: { host: 'shop.test', 'x-forwarded-proto': 'https' } } } };
    const direct = { path: '/x', node: { req: { headers: { host: 'shop.test' }, socket: { encrypted: true } } } };

    assert.equal(describeEvent(behindProxy).http.url, 'https://shop.test/x');
    assert.equal(describeEvent(direct).http.url, 'https://shop.test/x');
});

test('a path that is already absolute is left alone', () => {
    assert.equal(describeEvent({ path: 'http://cdn.test/a.js' }).http.url, 'http://cdn.test/a.js');
});

test('the address falls back down the chain and ends at unknown', () => {
    const forwarded = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } };
    const real = { headers: { 'x-real-ip': '198.51.100.4' } };
    const socket = { node: { req: { headers: {}, socket: { remoteAddress: '10.0.0.1' } } } };

    assert.equal(addressOf(forwarded), '203.0.113.7', 'only the client-facing hop, not the proxy chain');
    assert.equal(addressOf(real), '198.51.100.4');
    assert.equal(addressOf(socket), '10.0.0.1');
    assert.equal(addressOf({}), 'unknown');
});

test('a transaction is named after the matched route, not the path', () => {
    assert.equal(routeNameFor(h3Event()), 'GET /orders/:id');
    assert.equal(routeNameFor(h3Event({ matched: null })), 'GET /orders/8123');
    assert.equal(routeNameFor(workerEvent({ method: 'post' })), 'POST /orders/8123');
    assert.equal(routeNameFor({}), 'GET /');
});

test('ignored paths stay out of the panel', () => {
    assert.equal(shouldIgnore(h3Event({ path: '/_nuxt/entry.js' }), ['/_nuxt']), true);
    assert.equal(shouldIgnore(h3Event(), ['/_nuxt']), false);
    assert.equal(shouldIgnore(h3Event({ path: '/health' }), ['/_nuxt', '/health']), true);
    assert.equal(shouldIgnore(h3Event({ path: '/_nuxt/entry.js' })), false, 'nothing is ignored by default');
});
