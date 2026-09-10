import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import test from 'node:test';

import { withPanel } from './helpers.js';

/*
 | The route is imported as Nitro would build it, with `#imports` resolved to
 | a stub. Registering the hook has to happen before the route is loaded, so
 | the imports below are dynamic — and on a runtime without loader hooks the
 | route cannot be loaded at all, so the file reports its tests as skipped
 | rather than failing to parse.
 */
const supported = typeof nodeModule.register === 'function';
const suite = supported ? test : test.skip;

if (supported) {
    nodeModule.register('./stubs/loader.js', import.meta.url);
}

const nuxtImports = await import('./stubs/nuxt-imports.js');
const { resetRay, useRay } = await import('../src/runtime/server/client.js');
const handler = supported ? (await import('../src/runtime/server/api/browser.js')).default : null;

/** Waits on the reports the route sent without making the visitor wait. */
function flush() {
    return useRay(nuxtImports.state.config.ray ?? {}).flush();
}

function report({ address = '203.0.113.7', body = JSON.stringify({ message: 'boom' }), headers = {} } = {}) {
    return handler({
        body,
        headers: { 'x-forwarded-for': address, ...headers },
    });
}

test.afterEach(() => {
    resetRay();
    nuxtImports.reset();
});

suite('a report is forwarded with the project key the browser never sees', async () => {
    await withPanel(async (url, received) => {
        nuxtImports.reset({ ray: { token: 'tok', privateKey: 'key', url } });

        const answer = await report({
            address: '203.0.113.10',
            headers: { referer: 'https://shop.test/cart', 'user-agent': 'Firefox/130' },
        });

        assert.deepEqual(answer, { success: true });
        assert.equal(nuxtImports.state.status, 202);

        await flush();

        assert.equal(received.length, 1);
        assert.equal(received[0].path, '/api/v1/tok/project');
        assert.equal(received[0].payload.tags.source, 'browser');
        assert.equal(received[0].payload.request.url, 'https://shop.test/cart');
    });
});

suite('every outcome gets the same answer, so the guards stay invisible', async () => {
    await withPanel(async (url, received) => {
        nuxtImports.reset({ ray: { token: 'tok', privateKey: 'key', url } });

        for (const body of ['not json', '', 'x'.repeat(20000), JSON.stringify({ message: 'boom' })]) {
            nuxtImports.state.status = null;

            assert.deepEqual(await report({ address: '203.0.113.11', body }), { success: true });
            assert.equal(nuxtImports.state.status, 202);
        }

        await flush();

        assert.equal(received.length, 1, 'only the one report that was worth forwarding');
    });
});

suite('the route answers the same way when the module has no credentials', async () => {
    nuxtImports.reset({});

    assert.deepEqual(await report({ address: '203.0.113.12' }), { success: true });
    assert.equal(nuxtImports.state.status, 202);
});

suite('the flood limit is per caller, so one looping page cannot silence the rest', async () => {
    await withPanel(async (url, received) => {
        nuxtImports.reset({ ray: { token: 'tok', privateKey: 'key', url } });

        for (let index = 0; index < 21; index += 1) {
            await report({ address: '203.0.113.20', body: JSON.stringify({ message: `boom ${index}` }) });
        }

        await report({ address: '203.0.113.21', body: JSON.stringify({ message: 'from someone else' }) });
        await flush();

        const messages = received.map(({ payload }) => payload.message);

        assert.equal(messages.filter((message) => message.startsWith('boom')).length, 20, 'the page is capped');
        assert.ok(messages.includes('from someone else'), 'the other visitor still gets through');
    });
});
