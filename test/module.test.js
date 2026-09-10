import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { runWithNuxtContext } from '@nuxt/kit';

import rayModule from '../src/module.js';
import { fakeNuxt } from './helpers.js';

/**
 * Runs the module's setup against a stand-in Nuxt and hands back the instance
 * so the test can read what the module wrote into it.
 */
async function install({ ray = {}, runtimeConfig = {} } = {}) {
    const nuxt = fakeNuxt({ ray, runtimeConfig });

    await runWithNuxtContext(nuxt, () => rayModule({}, nuxt));

    return nuxt;
}

test('credentials go into the private runtime config and nowhere near the public one', async () => {
    const { options } = await install({ ray: { token: 'tok-live', privateKey: 'key-live', browser: { enabled: true } } });

    assert.equal(options.runtimeConfig.ray.token, 'tok-live');
    assert.equal(options.runtimeConfig.ray.privateKey, 'key-live');

    const published = JSON.stringify(options.runtimeConfig.public);

    assert.equal(published.includes('tok-live'), false, 'the token must not reach the client bundle');
    assert.equal(published.includes('key-live'), false, 'the private key must not reach the client bundle');
});

test('the public config carries the browser section and nothing else', async () => {
    const { options } = await install({ ray: { token: 'tok', privateKey: 'key' } });

    assert.deepEqual(Object.keys(options.runtimeConfig.public.ray), ['browser']);
    assert.deepEqual(Object.keys(options.runtimeConfig.public.ray.browser).sort(), [
        'enabled',
        'endpoint',
        'maxEvents',
        'release',
        'sampleRate',
    ]);
});

test('the defaults are conservative: off, unsampled tracing, noise ignored', async () => {
    const { options } = await install();

    assert.equal(options.runtimeConfig.public.ray.browser.enabled, false);
    assert.equal(options.runtimeConfig.ray.tracesSampleRate, 0);
    assert.equal(options.runtimeConfig.ray.sampleRate, 1);
    assert.equal(options.runtimeConfig.ray.sendDefaultPii, false);
    assert.equal(options.runtimeConfig.ray.url, 'https://dockray.io');
    assert.deepEqual(options.runtimeConfig.ray.ignorePaths, ['/_nuxt', '/__nuxt', '/health', '/metrics']);
});

test('the browser half inherits the app release unless it sets its own', async () => {
    const inherited = await install({ ray: { release: '2.1.0' } });
    const explicit = await install({ ray: { release: '2.1.0', browser: { release: '2.1.0-browser' } } });

    assert.equal(inherited.options.runtimeConfig.public.ray.browser.release, '2.1.0');
    assert.equal(explicit.options.runtimeConfig.public.ray.browser.release, '2.1.0-browser');
});

test('an existing runtime config wins, so NUXT_ env vars are not overwritten', async () => {
    const { options } = await install({
        ray: { token: 'from-nuxt-config', privateKey: 'key' },
        runtimeConfig: { ray: { token: 'from-the-environment' } },
    });

    assert.equal(options.runtimeConfig.ray.token, 'from-the-environment');
    assert.equal(options.runtimeConfig.ray.privateKey, 'key', 'the rest of the section is still filled in');
});

test('the server plugin is always installed', async () => {
    const { options } = await install();

    assert.equal(options.nitro.plugins.length, 1);
    assert.match(options.nitro.plugins[0], /runtime[/\\]server[/\\]plugin\.js$/);
});

test('nothing browser-side is wired while the browser half is off', async () => {
    const { options } = await install({ ray: { token: 'tok', privateKey: 'key' } });

    assert.deepEqual(options.serverHandlers, []);
    assert.deepEqual(options.plugins, []);
});

test('enabling the browser half adds the collecting route and the client plugin', async () => {
    const { options } = await install({
        ray: { token: 'tok', privateKey: 'key', browser: { enabled: true, endpoint: '/api/_ray/collect' } },
    });

    assert.equal(options.serverHandlers.length, 1);
    assert.equal(options.serverHandlers[0].route, '/api/_ray/collect');
    assert.equal(options.serverHandlers[0].method, 'post');
    assert.match(options.serverHandlers[0].handler, /runtime[/\\]server[/\\]api[/\\]browser\.js$/);

    assert.equal(options.plugins.length, 1);
    assert.equal(options.plugins[0].mode, 'client', 'the collector must never run during SSR');
    assert.match(options.plugins[0].src, /runtime[/\\]plugins[/\\]browser\.client\.js$/);
});

test('the module is registered under the `ray` config key', async () => {
    const meta = await rayModule.getMeta();

    assert.equal(meta.configKey, 'ray');
    assert.equal(meta.name, '@dockcodes/dock-ray-nuxt');
});

test('the client plugin never imports the node client', () => {
    for (const file of readdirSync(new URL('../src/runtime/plugins/', import.meta.url))) {
        const source = readFileSync(new URL(`../src/runtime/plugins/${file}`, import.meta.url), 'utf8');

        assert.deepEqual([...source.matchAll(/from '(node:[^']+)'/g)], []);
        assert.equal(source.includes("from '@dockcodes/dock-ray'"), false);
    }
});
