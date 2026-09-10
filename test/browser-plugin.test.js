import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import test from 'node:test';

/*
 | The plugin ships against Nuxt's auto-imports and against a browser. Both
 | are stubbed: `#imports` through the loader hook, and the page through a
 | `window` the collector can install its handlers on. Without loader hooks
 | there is no way to resolve `#imports`, so the file skips instead.
 */
const supported = typeof nodeModule.register === 'function';
const suite = supported ? test : test.skip;

if (supported) {
    nodeModule.register('./stubs/loader.js', import.meta.url);
}

const nuxtImports = await import('./stubs/nuxt-imports.js');
const plugin = supported ? (await import('../src/runtime/plugins/browser.client.js')).default : null;

function fakePage() {
    const sent = [];

    globalThis.document = { referrer: 'https://shop.test/' };
    globalThis.window = {
        location: { href: 'https://shop.test/cart' },
        addEventListener() {},
        removeEventListener() {},
        fetch(url, options) {
            sent.push({ url, options, body: JSON.parse(options.body) });

            return Promise.resolve();
        },
    };

    return sent;
}

function fakeNuxtApp() {
    const hooks = new Map();

    return {
        hook: (name, fn) => hooks.set(name, fn),
        fire: (name, ...args) => hooks.get(name)?.(...args),
        has: (name) => hooks.has(name),
    };
}

function start(browser) {
    nuxtImports.reset({ public: { ray: { browser } } });

    const sent = fakePage();
    const nuxtApp = fakeNuxtApp();

    plugin(nuxtApp);

    return { nuxtApp, sent };
}

test.afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    nuxtImports.reset();
});

suite('nothing is installed while the browser half is off', () => {
    const { nuxtApp } = start({ enabled: false, endpoint: '/api/_ray/browser' });

    assert.equal(nuxtApp.has('vue:error'), false);
    assert.equal(globalThis.window.DockRay, undefined, 'no collector, no global');
});

suite('nothing is installed when the module was never configured', () => {
    nuxtImports.reset({ public: {} });

    const sent = fakePage();
    const nuxtApp = fakeNuxtApp();

    plugin(nuxtApp);

    assert.equal(nuxtApp.has('vue:error'), false);
    assert.deepEqual(sent, []);
});

suite('a Vue render error reaches the collector', () => {
    const { nuxtApp, sent } = start({ enabled: true, endpoint: '/api/_ray/browser' });

    nuxtApp.fire('vue:error', new TypeError('null is not an object'));

    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.type, 'TypeError');
    assert.equal(sent[0].body.message, 'null is not an object');
    assert.equal(sent[0].body.handler, 'manual');
    assert.equal(sent[0].body.url, 'https://shop.test/cart');
});

suite('a fatal boot error reaches it too, even when it is not an Error', () => {
    const { nuxtApp, sent } = start({ enabled: true, endpoint: '/api/_ray/browser' });

    nuxtApp.fire('app:error', 'the app could not start');

    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.type, 'Error');
    assert.equal(sent[0].body.message, 'the app could not start');
});

suite('reports go to this app, never to the panel, and carry no key', () => {
    const { nuxtApp, sent } = start({ enabled: true, endpoint: '/api/_ray/collect' });

    nuxtApp.fire('vue:error', new Error('boom'));

    assert.equal(sent[0].url, '/api/_ray/collect');
    assert.equal(sent[0].options.method, 'POST');
    assert.equal(sent[0].options.credentials, 'same-origin');
    assert.equal(sent[0].options.keepalive, true, 'a report survives the page it was thrown on');
    assert.equal(sent[0].options.headers['X-DockRay-Token'], undefined);
});

suite('the release configured for the browser rides along', () => {
    const { nuxtApp, sent } = start({ enabled: true, endpoint: '/api/_ray/browser', release: '2.1.0' });

    nuxtApp.fire('vue:error', new Error('boom'));

    assert.equal(sent[0].body.release, '2.1.0');
});

suite('the same failure repeating in a render loop is reported once', () => {
    const { nuxtApp, sent } = start({ enabled: true, endpoint: '/api/_ray/browser' });
    const error = new TypeError('null is not an object');

    nuxtApp.fire('vue:error', error);
    nuxtApp.fire('vue:error', error);

    assert.equal(sent.length, 1, 'a page view is worth one report per distinct failure');
});

suite('a page stops reporting once it has spent its budget', () => {
    const { nuxtApp, sent } = start({ enabled: true, endpoint: '/api/_ray/browser', maxEvents: 2 });

    nuxtApp.fire('vue:error', new Error('first'));
    nuxtApp.fire('vue:error', new Error('second'));
    nuxtApp.fire('vue:error', new Error('third'));

    assert.deepEqual(sent.map(({ body }) => body.message), ['first', 'second']);
});
