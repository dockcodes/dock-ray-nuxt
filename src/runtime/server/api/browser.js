import { defineEventHandler, getRequestHeaders, readRawBody, setResponseStatus, useRuntimeConfig } from '#imports';
import { useThor } from '../client.js';
import { addressOf } from '../request.js';
import { createRateLimiter, forwardBrowserReport } from '../browser.js';

const limiter = createRateLimiter();

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig().thor ?? {};

    forwardBrowserReport(useThor(config), {
        body: await readRawBody(event, 'utf8'),
        headers: getRequestHeaders(event),
        address: addressOf(event),
        limiter,
    });

    // One answer for every outcome: a caller learns nothing about the guards.
    setResponseStatus(event, 202);

    return { success: true };
});
