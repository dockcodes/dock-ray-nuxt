const MAX_BODY_BYTES = 16384;

/**
 * Accepts a JavaScript error reported by the browser and forwards it.
 *
 * The browser holds no project key, so it authenticates against this app only;
 * the key is applied here. Everything in `body` came off the network and is
 * treated as untrusted — the SDK keeps the fields it recognises and refuses
 * the rest.
 */
export function forwardBrowserReport(ray, { body, headers = {}, address = 'unknown', limiter }) {
    if (!ray.enabled) {
        return false;
    }

    if (typeof body !== 'string' || body === '' || body.length > MAX_BODY_BYTES) {
        return false;
    }

    if (limiter && !limiter.allow(address)) {
        return false;
    }

    let payload = null;

    try {
        payload = JSON.parse(body);
    } catch {
        return false;
    }

    ray.report(ray.captureBrowserReport(payload, {
        pageUrl: headers.referer,
        userAgent: headers['user-agent'],
    }));

    return true;
}

/**
 * A fixed window per address, held in process memory. It exists to stop one
 * looping page from flooding the panel, not to be an authorisation boundary —
 * so a per-instance counter is enough, and no shared store is worth the cost.
 */
export function createRateLimiter({ limit = 20, windowMs = 60000, maxKeys = 10000 } = {}) {
    const seen = new Map();

    return {
        allow(key) {
            const now = Date.now();
            const entry = seen.get(key);

            if (!entry || now - entry.since > windowMs) {
                if (seen.size > maxKeys) {
                    seen.clear();
                }

                seen.set(key, { since: now, count: 1 });

                return true;
            }

            entry.count += 1;

            return entry.count <= limit;
        },
    };
}
