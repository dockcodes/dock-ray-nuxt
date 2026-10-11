import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { InventoryReporter } from '@dockcodes/dock-ray';
import { useRay, resetRay } from '../src/runtime/server/client.js';
import { registerRayHooks } from '../src/runtime/server/nitro.js';

function environment(t, settings) {
    const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    Object.assign(process.env, settings);
    t.after(() => { for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    } });
}

test('inventory runtime settings remain private', async () => {
    const source = await readFile(new URL('../src/module.js', import.meta.url), 'utf8');
    const publicBlock = source.slice(source.indexOf('runtimeConfig.public.ray'));
    for (const key of ['inventoryEnabled', 'inventoryExcludePackages', 'inventoryProjectDirectory', 'inventoryStateDirectory']) {
        assert.ok(source.slice(0, source.indexOf('runtimeConfig.public.ray')).includes(`${key}: options.${key}`));
        assert.equal(publicBlock.includes(key), false);
    }
});

test('inventory is opt-in, respects explicit false, and reset disposes the SDK timer', async t => {
    environment(t, { RAY_INVENTORY: 'true', RAY_ENVIRONMENT: 'development' });
    t.after(resetRay);
    const disabled = useRay({ inventoryEnabled: false });
    assert.equal(disabled.inventory.timer, undefined);
    assert.equal((await disabled.reportInventory()).status, 'disabled');
    await resetRay();
    const ray = useRay({});
    assert.ok(ray.inventory instanceof InventoryReporter);
    assert.equal(ray.environment, 'development');
    assert.equal(ray.inventory.options.environment, 'development');
    assert.equal(ray.inventory.timer.hasRef(), false);
    assert.equal(useRay({ inventoryEnabled: false }), ray);
    await resetRay();
    assert.equal(ray.inventory.timer, null);
    assert.equal(ray.inventory.initial, null);
});

test('Nuxt config overrides environment and string false does not enable reporting', async t => {
    environment(t, { RAY_INVENTORY: 'true', RAY_ENVIRONMENT: 'production' });
    t.after(resetRay);
    const ray = useRay({ inventoryEnabled: 'false', environment: 'preview' });
    assert.equal(ray.environment, 'preview');
    assert.equal((await ray.reportInventory()).status, 'disabled');
});

test('prerender and non-Node build flags prevent inventory scheduling', async () => {
    const source = await readFile(new URL('../src/runtime/server/client.js', import.meta.url), 'utf8');
    for (const [prerender, node] of [[true, true], [false, false]]) {
        const compiled = source.replace("'@dockcodes/dock-ray'", JSON.stringify(import.meta.resolve('@dockcodes/dock-ray')))
            .replace('import.meta.prerender', String(prerender)).replace('import.meta.dockrayNode', String(node));
        const runtime = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
        const ray = runtime.useRay({ inventoryEnabled: true });
        assert.equal(ray.inventory.timer, undefined);
        assert.equal((await ray.reportInventory()).status, 'disabled');
        await runtime.resetRay();
    }
});

test('Nitro close disposes inventory even without event credentials', async t => {
    t.after(resetRay);
    const ray = useRay({ inventoryEnabled: true, token: '', privateKey: '' });
    const hooks = new Map();
    registerRayHooks({ hooks: { hook: (name, callback) => hooks.set(name, callback) } }, ray);
    assert.equal(hooks.has('request'), false);
    assert.equal(hooks.has('close'), true);
    await hooks.get('close')();
    assert.equal(ray.inventory.timer, null);
});

test('Nuxt sends installed package versions via Node SDK without URL and honors throttling', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dockray-nuxt-test-'));
    t.after(async () => { await resetRay(); await rm(root, { recursive: true, force: true }); });
    const manifest = { name: 'site', dependencies: { nuxt: '^4.0.0', 'private-pkg': '1.0.0' } };
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3,
        packages: { '': manifest, 'node_modules/nuxt': { version: '4.0.0' }, 'node_modules/private-pkg': { version: '1.0.0' } } }));
    for (const [name, version] of [['nuxt', '4.0.0'], ['private-pkg', '1.0.0']]) {
        await mkdir(join(root, 'node_modules', name), { recursive: true });
        await writeFile(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    }
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, request) => {
        requests.push({ url, request });
        return new Response('{"success":true,"vulnerable":1,"next_report_in":43200}');
    });
    const ray = useRay({ token: 'project', privateKey: 'private-key', inventoryEnabled: 'true',
        environment: 'preview', inventoryProjectDirectory: root, inventoryStateDirectory: join(root, 'state'),
        inventoryExcludePackages: ' private-* , ' });
    assert.equal((await ray.reportInventory()).status, 'sent');
    assert.equal(requests.length, 1);
    const payload = JSON.parse(requests[0].request.body);
    assert.equal(payload.platform, 'nodejs');
    assert.equal(payload.environment, 'dev');
    assert.equal(payload.components.length, 1);
    assert.equal(payload.components[0].slug, 'nuxt@4.0.0');
    assert.equal(Object.hasOwn(payload, 'site_url'), false);
    assert.equal(requests[0].request.headers.Authorization, 'Bearer private-key');
    assert.equal(requests[0].request.redirect, 'error');
    assert.equal((await ray.reportInventory()).status, 'not_due');
    assert.equal(requests.length, 1);
});
