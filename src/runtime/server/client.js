import { DockThorClient } from '@dockcodes/dock-thor';

let client = null;

/**
 * One client per Nitro process.
 *
 * Built on first use rather than at import time, because `useRuntimeConfig()`
 * is only meaningful once Nitro has started — importing this module during the
 * build must not try to read it.
 */
export function useThor(config) {
    if (client) {
        return client;
    }

    client = new DockThorClient({
        token: config.token,
        privateKey: config.privateKey,
        url: config.url,
        environment: config.environment || process.env.NODE_ENV || 'production',
        release: config.release || undefined,
        sampleRate: Number(config.sampleRate ?? 1),
        tracesSampleRate: Number(config.tracesSampleRate ?? 0),
        sendDefaultPii: Boolean(config.sendDefaultPii),
    });

    return client;
}

export function resetThor() {
    client = null;
}
