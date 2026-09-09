import { collectorConfig, startCollector } from '@dockcodes/dock-ray/browser';
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';

/**
 * Starts browser error collection and hands Vue's own errors to it.
 *
 * Reports go to the Nitro route in this app, never to the panel: the browser
 * has no project key, and giving it one would publish it.
 */
export default defineNuxtPlugin((nuxtApp) => {
    const options = useRuntimeConfig().public.ray?.browser;

    if (!options?.enabled) {
        return;
    }

    const stop = startCollector(collectorConfig(options));

    /*
     | Vue swallows component errors into its own handler, so `window.onerror`
     | never sees them. Both Nuxt hooks are wired: `vue:error` for render and
     | lifecycle failures, `app:error` for a fatal boot.
     */
    nuxtApp.hook('vue:error', (error) => window.DockRay?.captureException(normalise(error)));
    nuxtApp.hook('app:error', (error) => window.DockRay?.captureException(normalise(error)));

    if (import.meta.hot) {
        import.meta.hot.dispose(stop);
    }
});

function normalise(error) {
    return error instanceof Error ? error : new Error(String(error));
}
