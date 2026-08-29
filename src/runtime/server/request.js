const SENSITIVE = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-dockthor-token']);

/**
 * Reads an H3 event without importing h3.
 *
 * Nitro runs the same handler on Node and on workers, where `event.node` is
 * absent and a Fetch `Request` takes its place. Reading both shapes keeps the
 * module deployable to either without a second code path.
 */
export function describeEvent(event) {
    const headers = headersOf(event);
    const method = (event?.method ?? event?.node?.req?.method ?? 'GET').toUpperCase();
    const forwarded = headers['x-forwarded-for'];

    return {
        http: {
            url: urlOf(event, headers),
            method,
            headers: Object.fromEntries(
                Object.entries(headers).filter(([name]) => !SENSITIVE.has(name)),
            ),
        },
        user: dropEmpty({
            ip_address: forwarded ? forwarded.split(',')[0].trim() : headers['x-real-ip'],
            agent: headers['user-agent'],
        }),
    };
}

/**
 * The matched route, not the concrete path: `/orders/:id` keeps one route as
 * one row in the panel instead of one row per order.
 */
export function routeNameFor(event) {
    const method = (event?.method ?? event?.node?.req?.method ?? 'GET').toUpperCase();
    const pattern = event?.context?.matchedRoute?.path ?? pathOf(event);

    return `${method} ${pattern}`;
}

export function shouldIgnore(event, ignorePaths = []) {
    const path = pathOf(event);

    return ignorePaths.some((ignored) => path.startsWith(ignored));
}

export function addressOf(event) {
    const headers = headersOf(event);
    const forwarded = headers['x-forwarded-for'];

    return forwarded?.split(',')[0].trim()
        ?? headers['x-real-ip']
        ?? event?.node?.req?.socket?.remoteAddress
        ?? 'unknown';
}

export function headersOf(event) {
    const raw = event?.node?.req?.headers ?? event?.web?.request?.headers ?? event?.headers;

    if (!raw) {
        return {};
    }

    if (typeof raw.entries === 'function') {
        return Object.fromEntries([...raw.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    }

    return Object.fromEntries(
        Object.entries(raw)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key.toLowerCase(), value]),
    );
}

function pathOf(event) {
    return event?.path ?? event?.node?.req?.url ?? '/';
}

function urlOf(event, headers) {
    const path = pathOf(event);

    if (path.startsWith('http')) {
        return path;
    }

    const host = headers.host ?? 'localhost';
    const protocol = headers['x-forwarded-proto'] ?? (event?.node?.req?.socket?.encrypted ? 'https' : 'http');

    return `${protocol}://${host}${path}`;
}

function dropEmpty(object) {
    const entries = Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '');

    return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
