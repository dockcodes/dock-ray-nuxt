import { useRuntimeConfig } from '#imports';
import { useRay } from './client.js';
import { registerRayHooks } from './nitro.js';

export default function rayNitroPlugin(nitroApp) {
    const config = useRuntimeConfig().ray ?? {};

    registerRayHooks(nitroApp, useRay(config), config);
}
