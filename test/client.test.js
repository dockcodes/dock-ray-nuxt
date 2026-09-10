import assert from 'node:assert/strict';
import test from 'node:test';

import { resetRay, useRay } from '../src/runtime/server/client.js';

const config = { token: 'tok', privateKey: 'key', url: 'http://127.0.0.1:1' };

test.afterEach(() => resetRay());

test('one client is shared by every request in the process', () => {
    const first = useRay(config);
    const second = useRay({ ...config, token: 'a-different-token' });

    assert.equal(first, second, 'the config is read once, on first use');

    resetRay();

    assert.notEqual(useRay(config), first);
});

test('a client without credentials is built, but disabled', () => {
    const ray = useRay({});

    assert.equal(ray.enabled, false, 'a missing key must not throw at boot');
});

test('the environment falls back to NODE_ENV and then to production', () => {
    const original = process.env.NODE_ENV;

    try {
        process.env.NODE_ENV = 'staging';
        assert.equal(useRay(config).environment, 'staging');

        resetRay();
        assert.equal(useRay({ ...config, environment: 'canary' }).environment, 'canary');

        resetRay();
        delete process.env.NODE_ENV;
        assert.equal(useRay(config).environment, 'production');
    } finally {
        if (original === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = original;
        }
    }
});

test('rates arriving as strings from the environment are numbers on the client', () => {
    const ray = useRay({ ...config, sampleRate: '0.5', tracesSampleRate: '0.25', sendDefaultPii: 'true' });

    assert.equal(ray.sampleRate, 0.5);
    assert.equal(ray.tracesSampleRate, 0.25);
    assert.equal(ray.sendDefaultPii, true);
});

test('an empty release is no release, not the empty string', () => {
    assert.equal(useRay({ ...config, release: '' }).release, undefined);

    resetRay();

    assert.equal(useRay({ ...config, release: '2.1.0' }).release, '2.1.0');
});
