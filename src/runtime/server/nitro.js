import { describeEvent, routeNameFor, shouldIgnore } from './request.js';

/**
 * Registers the Nitro hooks. Split from the plugin entry point so it can be
 * exercised without a running Nuxt app.
 */
export function registerRayHooks(nitroApp, ray, config = {}) {
    if (!ray.enabled) {
        return;
    }

    nitroApp.hooks.hook('request', (event) => {
        event.context = event.context ?? {};
        event.context.rayStartedAt = Date.now() / 1000;
    });

    nitroApp.hooks.hook('error', (error, context = {}) => {
        if (isExpectedHttpError(error)) {
            return;
        }

        const event = context.event;
        const described = event ? describeEvent(event) : {};

        ray.report(ray.captureException(error, {
            request: described.http,
            user: described.user,
            tags: event ? { route: routeNameFor(event) } : {},
        }));
    });

    /*
     | `afterResponse` fires once the reply has been written, so the request to
     | the panel starts when the visitor already has their bytes.
     */
    nitroApp.hooks.hook('afterResponse', (event) => {
        const startedAt = event?.context?.rayStartedAt;

        if (!startedAt || shouldIgnore(event, config.ignorePaths ?? [])) {
            return;
        }

        const described = describeEvent(event);

        ray.report(ray.captureTransaction({
            name: routeNameFor(event),
            url: described.http.url,
            method: described.http.method,
            statusCode: event.node?.res?.statusCode ?? 200,
            startTimestamp: startedAt,
            endTimestamp: Date.now() / 1000,
            request: described.http,
            user: described.user,
        }));
    });

    nitroApp.hooks.hook('close', () => ray.close());
}

/**
 * A 404 or a 422 is the caller getting it wrong, not the application failing.
 * Only server faults belong in the panel.
 */
function isExpectedHttpError(error) {
    const status = error?.statusCode ?? error?.status ?? 500;

    return status < 500;
}
