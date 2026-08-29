import { useRuntimeConfig } from '#imports';
import { useThor } from './client.js';
import { registerThorHooks } from './nitro.js';

export default function thorNitroPlugin(nitroApp) {
    const config = useRuntimeConfig().thor ?? {};

    registerThorHooks(nitroApp, useThor(config), config);
}
