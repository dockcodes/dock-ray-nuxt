import { DockRayClient } from '@dockcodes/dock-ray';

let client = null;

/**
 * One client per Nitro process.
 *
 * Built on first use rather than at import time, because `useRuntimeConfig()`
 * is only meaningful once Nitro has started - importing this module during the
 * build must not try to read it.
 */
export function useRay(config) {
    if (client) {
        return client;
    }

    client = new DockRayClient({
        token: config.token,
        privateKey: config.privateKey,
        url: config.url,
        environment: config.environment || process.env.RAY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
        release: config.release || undefined,
        inventoryEnabled: import.meta.prerender !== true && import.meta.dockrayNode !== false
            && enabled(config.inventoryEnabled ?? process.env.RAY_INVENTORY),
        inventoryExcludePackages: exclusions(config.inventoryExcludePackages ?? process.env.RAY_INVENTORY_EXCLUDE_PACKAGES ?? []),
        inventoryProjectDirectory: config.inventoryProjectDirectory || process.env.RAY_INVENTORY_PROJECT_DIR || undefined,
        inventoryStateDirectory: config.inventoryStateDirectory || process.env.RAY_INVENTORY_STATE_DIR || undefined,
        sampleRate: Number(config.sampleRate ?? 1),
        tracesSampleRate: Number(config.tracesSampleRate ?? 0),
        sendDefaultPii: Boolean(config.sendDefaultPii),
    });

    return client;
}

export async function resetRay() {
    const previous = client;
    client = null;
    if (previous) await previous.close();
}

function enabled(value) {
    return value === true || value === 'true';
}

function exclusions(value) {
    return typeof value === 'string' ? value.split(',').map(name => name.trim()).filter(Boolean) : value;
}
