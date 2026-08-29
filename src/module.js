import { addPlugin, addServerHandler, addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit';

/**
 * Nuxt module wiring DockTHOR into both halves of the app.
 *
 * The server half gets the credentials and reports directly. The browser half
 * never does: its errors go to a Nitro route in this same app, which forwards
 * them with the project key. A key in a client bundle is a published key.
 */
export default defineNuxtModule({
    meta: {
        name: '@dockcodes/dock-thor-nuxt',
        configKey: 'thor',
        compatibility: { nuxt: '>=3.0.0' },
    },

    defaults: {
        token: '',
        privateKey: '',
        url: 'https://thor.dock.codes',
        environment: '',
        release: '',
        sampleRate: 1,
        tracesSampleRate: 0,
        sendDefaultPii: false,
        ignorePaths: ['/_nuxt', '/__nuxt', '/health', '/metrics'],
        browser: {
            enabled: false,
            endpoint: '/api/_thor/browser',
            sampleRate: 1,
            maxEvents: 10,
        },
    },

    setup(options, nuxt) {
        const { resolve } = createResolver(import.meta.url);

        /*
         | Credentials go into runtimeConfig, not into `public`: everything
         | under `public` is serialised into the client bundle. The browser
         | section is public on purpose — it holds only an endpoint path.
         */
        nuxt.options.runtimeConfig.thor = {
            token: options.token,
            privateKey: options.privateKey,
            url: options.url,
            environment: options.environment,
            release: options.release,
            sampleRate: options.sampleRate,
            tracesSampleRate: options.tracesSampleRate,
            sendDefaultPii: options.sendDefaultPii,
            ignorePaths: options.ignorePaths,
            ...nuxt.options.runtimeConfig.thor,
        };

        nuxt.options.runtimeConfig.public.thor = {
            browser: {
                ...options.browser,
                release: options.browser.release ?? options.release,
            },
            ...nuxt.options.runtimeConfig.public.thor,
        };

        addServerPlugin(resolve('./runtime/server/plugin.js'));

        if (options.browser.enabled) {
            addServerHandler({
                route: options.browser.endpoint,
                method: 'post',
                handler: resolve('./runtime/server/api/browser.js'),
            });

            addPlugin({ src: resolve('./runtime/plugins/browser.client.js'), mode: 'client' });
        }
    },
});
