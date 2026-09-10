/**
 * Stands in for Nuxt's `#imports` alias.
 *
 * The server route and the client plugin are written against auto-imports
 * that only exist inside a built Nuxt app. Resolving that alias here (see
 * `loader.js`) lets both files be exercised as they ship, rather than being
 * covered by a copy of their logic.
 */

export const state = {
    config: { public: {} },
    status: null,
};

export function reset(config = { public: {} }) {
    state.config = config;
    state.status = null;
}

export const defineEventHandler = (handler) => handler;
export const defineNuxtPlugin = (plugin) => plugin;
export const useRuntimeConfig = () => state.config;
export const getRequestHeaders = (event) => event.headers ?? {};
export const readRawBody = async (event) => event.body;

export function setResponseStatus(event, code) {
    state.status = code;
}
