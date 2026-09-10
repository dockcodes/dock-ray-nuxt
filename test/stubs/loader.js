/**
 * Module resolution hook: points `#imports` at the stub above. Registered by
 * the tests that load a file Nitro would have built.
 */
export function resolve(specifier, context, next) {
    if (specifier === '#imports') {
        return { url: new URL('./nuxt-imports.js', import.meta.url).href, shortCircuit: true };
    }

    return next(specifier, context);
}
