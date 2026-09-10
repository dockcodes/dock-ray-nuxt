import assert from 'node:assert/strict';
import test from 'node:test';

import { DockRayClient } from '@dockcodes/dock-ray';

import { createRateLimiter, forwardBrowserReport } from '../src/runtime/server/browser.js';
import { withPanel } from './helpers.js';

const MAX_BODY_BYTES = 16384;
const ENVELOPE = '{"message":""}'.length;

/** A JSON body of exactly `bytes` characters. */
function bodyOf(bytes) {
    return JSON.stringify({ message: 'x'.repeat(bytes - ENVELOPE) });
}

test('a browser report is forwarded with a server-side envelope', async () => {
    await withPanel(async (url, received) => {
        const ray = new DockRayClient({ token: 'tok', privateKey: 'key', url, environment: 'production' });

        const accepted = forwardBrowserReport(ray, {
            body: JSON.stringify({ type: 'TypeError', message: 'null is not an object' }),
            headers: { referer: 'https://shop.test/cart', 'user-agent': 'Firefox/130' },
            address: '203.0.113.7',
        });

        assert.equal(accepted, true);
        await ray.flush();

        assert.equal(received[0].payload.platform, 'javascript');
        assert.equal(received[0].payload.tags.source, 'browser');
        assert.equal(received[0].payload.environment, 'production');
    });
});

test('the page and the agent are taken from the request, not from the payload', async () => {
    await withPanel(async (url, received) => {
        const ray = new DockRayClient({ token: 'tok', privateKey: 'key', url });

        forwardBrowserReport(ray, {
            body: JSON.stringify({ message: 'boom' }),
            headers: { referer: 'https://shop.test/cart', 'user-agent': 'Firefox/130' },
        });

        await ray.flush();

        assert.equal(received[0].payload.request.url, 'https://shop.test/cart');
        assert.equal(received[0].payload.contexts.browser.user_agent, 'Firefox/130');
    });
});

test('a client without credentials accepts nothing', () => {
    const accepted = forwardBrowserReport(new DockRayClient(), { body: JSON.stringify({ message: 'boom' }) });

    assert.equal(accepted, false);
});

test('oversized, malformed and flooding reports are refused', async () => {
    await withPanel(async (url, received) => {
        const ray = new DockRayClient({ token: 'tok', privateKey: 'key', url });
        const post = (body, limiter) => forwardBrowserReport(ray, { body, address: '203.0.113.7', limiter });

        assert.equal(post(JSON.stringify({ message: 'x'.repeat(20000) })), false, 'over 16 KB');
        assert.equal(post('not json'), false, 'malformed');
        assert.equal(post(''), false, 'empty');
        assert.equal(post(undefined), false, 'no body at all');

        await ray.flush();
        assert.equal(received.length, 0, 'none of those reach the panel');

        const limiter = createRateLimiter({ limit: 2 });

        assert.equal(post(JSON.stringify({ message: 'a' }), limiter), true);
        assert.equal(post(JSON.stringify({ message: 'b' }), limiter), true);
        assert.equal(post(JSON.stringify({ message: 'c' }), limiter), false, 'past the window limit');

        await ray.flush();
        assert.equal(received.length, 2);
    });
});

test('the size limit is on the request, and 16 KB exactly still fits', async () => {
    await withPanel(async (url, received) => {
        const ray = new DockRayClient({ token: 'tok', privateKey: 'key', url });
        const post = (body) => forwardBrowserReport(ray, { body });

        assert.equal(post(bodyOf(MAX_BODY_BYTES)), true);
        assert.equal(post(bodyOf(MAX_BODY_BYTES + 1)), false);

        await ray.flush();
        assert.equal(received.length, 1);
    });
});

test('a well-formed request holding an unusable report is accepted and then dropped', async () => {
    await withPanel(async (url, received) => {
        const ray = new DockRayClient({ token: 'tok', privateKey: 'key', url });

        /*
         | The guards answer for the request; whether the report can be made
         | into an event is the SDK's call, and a caller learns nothing from
         | the difference.
         */
        assert.equal(forwardBrowserReport(ray, { body: JSON.stringify({ level: 'error' }) }), true);

        await ray.flush();
        assert.equal(received.length, 0, 'a report with no message is not an event');
    });
});

test('a flood of malformed bodies is rate limited too', () => {
    const ray = new DockRayClient({ token: 'tok', privateKey: 'key', url: 'http://127.0.0.1:1' });
    const limiter = createRateLimiter({ limit: 2 });
    const post = () => forwardBrowserReport(ray, { body: 'not json', address: '203.0.113.7', limiter });

    post();
    post();

    /*
     | The counter is spent whether or not the body parsed: rate limiting
     | exists to cap the requests, and junk costs the same to receive.
     */
    assert.equal(limiter.allow('203.0.113.7'), false);
});

test('one flooding page does not spend another visitor’s budget', () => {
    const limiter = createRateLimiter({ limit: 1 });

    assert.equal(limiter.allow('203.0.113.7'), true);
    assert.equal(limiter.allow('203.0.113.7'), false);
    assert.equal(limiter.allow('198.51.100.4'), true);
});

test('the window is fixed: the budget comes back once it has passed', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 5 });

    assert.equal(limiter.allow('203.0.113.7'), true);
    assert.equal(limiter.allow('203.0.113.7'), false);

    await new Promise((resolve) => setTimeout(resolve, 15));

    assert.equal(limiter.allow('203.0.113.7'), true);
});

test('the counters are swept rather than grown without bound', () => {
    const limiter = createRateLimiter({ limit: 1, maxKeys: 2 });

    for (const address of ['a', 'b', 'c']) {
        assert.equal(limiter.allow(address), true);
    }

    assert.equal(limiter.allow('a'), false, 'still counted while the map is small');
    assert.equal(limiter.allow('d'), true, 'the address past maxKeys clears the map');
    assert.equal(limiter.allow('a'), true, 'and everyone starts again from an empty one');
});
