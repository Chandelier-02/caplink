/**
 * Provides a Caplink adapter for Node.js WebWorker endpoints.
 * @module
 *
 * @example
 * ```ts
 * import { expose } from "@workers/caplink";
 * import { nodeEndpoint } from "@workers/caplink/node-adapter";
 * import { parentPort } from "node:worker_threads";
 * expose({ fn() {} }, nodeEndpoint(parentPort))
 * ```
 */
const mkl = (eh) => (data) => {
    if ("handleEvent" in eh) {
        eh.handleEvent({ data }); // XXX: doesn't work for non-MessageEvent
    }
    else {
        eh({ data }); // XXX: doesn't work for non-MessageEvent
    }
};
export default function nodeEndpoint(nep) {
    if (!('on' in nep) || !('off' in nep))
        return nep;
    const listeners = new WeakMap();
    return {
        postMessage: nep.postMessage.bind(nep),
        addEventListener: (name, eh) => {
            const l = mkl(eh);
            nep.on(name, l);
            listeners.set(eh, l);
        },
        removeEventListener: (name, eh) => {
            const l = listeners.get(eh);
            if (!l)
                return;
            nep.off(name, l);
            listeners.delete(eh);
        },
        ...nep.start && { start: nep.start.bind(nep) },
    };
}
//# sourceMappingURL=node-adapter.js.map