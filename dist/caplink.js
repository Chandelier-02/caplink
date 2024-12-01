/**
 * A modernized fork of [Comlink](https://github.com/GoogleChromeLabs/comlink) with many open PRs merged
 * and the ability to use proxies as values in Caplink calls.
 * @module
 */
/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { messageChannel, toNative, adoptNative, } from "./protocol.js";
export const proxyMarker = Symbol("Caplink.proxy");
export const createEndpoint = Symbol("Caplink.endpoint");
/** @deprecated Use `Symbol.dispose` or `Symbol.asyncDispose` instead */
export const releaseProxy = Symbol("Caplink.releaseProxy");
/** @deprecated Use `Symbol.dispose` or `Symbol.asyncDispose` instead */
export const finalizer = Symbol("Caplink.finalizer");
export { messageChannel, toNative, adoptNative };
const throwMarker = Symbol("Caplink.thrown");
const isObject = (val) => typeof val === "object" && val !== null;
const isReceiver = (val) => (typeof val === "object" && val !== null) || typeof val === "function";
const isNativeEndpoint = (x) => {
    return (("Worker" in globalThis && x instanceof globalThis.Worker) ||
        ("MessagePort" in globalThis && x instanceof globalThis.MessagePort));
};
const isNativeConvertible = (x) => {
    return isReceiver(x) && toNative in x;
};
/**
 * Internal transfer handle to handle objects marked to proxy.
 */
const proxyTransferHandler = {
    canHandle: (val) => proxyMarker in val || createEndpoint in val,
    serialize(obj, ep) {
        let port;
        if (createEndpoint in obj) {
            port = obj[createEndpoint]();
            if (isNativeEndpoint(ep) && isNativeConvertible(port)) {
                port = port[toNative]();
            }
            else if (ep[adoptNative] && isNativeEndpoint(port)) {
                port = ep[adoptNative](port);
            }
        }
        else {
            const { port1, port2 } = new (ep[messageChannel] ?? MessageChannel)();
            expose(obj, port1);
            port = port2;
        }
        return [port, [port]];
    },
    deserialize(port) {
        port.start();
        return wrap(port);
    },
};
const endpointState = new WeakMap();
/**
 * Internal transfer handler to handle thrown exceptions.
 */
const throwTransferHandler = {
    canHandle: (value) => throwMarker in value,
    serialize({ value }) {
        return [value, []];
    },
    deserialize(value) {
        throw value;
    },
};
/**
 * Allows customizing the serialization of certain values.
 */
export const transferHandlers = new Map([
    ["proxy", proxyTransferHandler],
    ["throw", throwTransferHandler],
]);
function isAllowedOrigin(allowedOrigins, origin) {
    for (const allowedOrigin of allowedOrigins) {
        if (origin === allowedOrigin || allowedOrigin === "*") {
            return true;
        }
        if (allowedOrigin instanceof RegExp && allowedOrigin.test(origin)) {
            return true;
        }
    }
    return false;
}
function isOurMessage(val) {
    return isObject(val) && "type" in val && "id" in val;
}
/** Keeping track of how many times an object was exposed. */
const objectCounter = new WeakMap();
/** Decrease an exposed objects's ref counter and potentially run its cleanup code. */
async function finalizeObject(obj) {
    const newCount = (objectCounter.get(obj) || 0) - 1;
    objectCounter.set(obj, newCount);
    if (newCount === 0) {
        // Run finalizers before sending message so caller can be sure that resources are freed up
        if ("dispose" in Symbol && Symbol.dispose in obj) {
            obj[Symbol.dispose]();
        }
        if ("asyncDispose" in Symbol && Symbol.asyncDispose in obj) {
            await obj[Symbol.asyncDispose]();
        }
        if (finalizer in obj && typeof obj[finalizer] === "function") {
            obj[finalizer]();
        }
    }
}
const locked = new WeakSet();
export function expose(object, ep = globalThis, allowedOrigins = ["*"]) {
    if (locked.has(ep))
        throw Error("Endpoint is already exposing another object and cannot be reused.");
    locked.add(ep);
    objectCounter.set(object, (objectCounter.get(object) || 0) + 1);
    ep.addEventListener("message", 
    //@ts-ignore
    async function callback(ev) {
        const obj = object;
        if (!ev || !ev.data || !isOurMessage(ev.data)) {
            return;
        }
        if (!isAllowedOrigin(allowedOrigins, ev.origin)) {
            console.warn(`Invalid origin '${ev.origin}' for caplink proxy`);
            return;
        }
        const { data } = ev;
        const { id, type } = data;
        let returnValue;
        try {
            switch (type) {
                case "GET" /* MessageType.GET */:
                    {
                        const rawValue = data.path.reduce((obj, prop) => obj[prop], obj);
                        returnValue = rawValue;
                    }
                    break;
                case "SET" /* MessageType.SET */:
                    {
                        const parent = data.path
                            .slice(0, -1)
                            .reduce((obj, prop) => obj[prop], obj);
                        parent[data.path.slice(-1)[0]] = fromWireValue.call(ep, data.value);
                        returnValue = true;
                    }
                    break;
                case "APPLY" /* MessageType.APPLY */:
                    {
                        const parent = data.path
                            .slice(0, -1)
                            .reduce((obj, prop) => obj[prop], obj);
                        const rawValue = data.path.reduce((obj, prop) => obj[prop], obj);
                        const argumentList = data.argumentList.map(fromWireValue, ep);
                        returnValue = rawValue.apply(parent, argumentList);
                    }
                    break;
                case "CONSTRUCT" /* MessageType.CONSTRUCT */:
                    {
                        const rawValue = data.path.reduce((obj, prop) => obj[prop], obj);
                        const argumentList = data.argumentList.map(fromWireValue, ep);
                        const value = new rawValue(...argumentList);
                        returnValue = proxy(value);
                    }
                    break;
                case "ENDPOINT" /* MessageType.ENDPOINT */:
                    {
                        expose(obj, data.value);
                        returnValue = undefined;
                    }
                    break;
                case "RELEASE" /* MessageType.RELEASE */:
                    {
                        returnValue = undefined;
                        finalizeObject(obj);
                    }
                    break;
                default:
                    return;
            }
        }
        catch (value) {
            returnValue = { value, [throwMarker]: 0 };
        }
        try {
            returnValue = await returnValue;
        }
        catch (value) {
            returnValue = { value, [throwMarker]: 0 };
        }
        {
            try {
                const [wireValue, transfer] = toWireValue.call(ep, returnValue);
                wireValue.id = id;
                // @ts-ignore
                (ev.source ?? ep).postMessage(wireValue, { transfer });
            }
            catch (err) {
                console.error(err);
                // Send Serialization Error To Caller
                const [wireValue, transfer] = toWireValue.call(ep, {
                    value: new TypeError("Unserializable return value"),
                    [throwMarker]: 0,
                });
                wireValue.id = id;
                // @ts-ignore
                (ev.source ?? ep).postMessage(wireValue, { transfer });
            }
            finally {
                if (type === "RELEASE" /* MessageType.RELEASE */) {
                    // detach and deactivate after sending release response above.
                    ep.removeEventListener("message", callback);
                    ep.removeEventListener("close", listener);
                    ep.removeEventListener("error", listener);
                    closeEndpoint(ep);
                }
            }
        }
    });
    // If the endpoint gets closed on us without a release message, we treat it the same so as not to prevent resource cleanup.
    // At most one of close and error should be handled so as not to falsify the object count.
    const listener = () => {
        finalizeObject(object);
        ep.removeEventListener("close", listener);
        ep.removeEventListener("error", listener);
    };
    ep.addEventListener("close", listener);
    ep.addEventListener("error", listener);
    ep.start?.();
}
function isCloseable(endpoint) {
    return "close" in endpoint && typeof endpoint.close === "function";
}
function closeEndpoint(endpoint) {
    if (isCloseable(endpoint))
        endpoint.close();
}
export function wrap(ep, target) {
    return createProxy(ep, [], target);
}
function throwIfProxyReleased(isReleased) {
    if (isReleased) {
        throw new Error("Proxy has been released and is not useable" +
            (typeof isReleased === "string" ? `: ${isReleased}` : ""), isReleased instanceof Error ? { cause: isReleased } : {});
    }
}
async function releaseEndpoint(ep, force = false) {
    if (endpointState.has(ep)) {
        const { resolvers, messageHandler } = endpointState.get(ep);
        try {
            const releasedPromise = !force && requestResponseMessage(ep, { type: "RELEASE" /* MessageType.RELEASE */ });
            endpointState.delete(ep); // prevent reentry
            await releasedPromise; // now save to await
        }
        finally {
            // Error all pending promises:
            resolvers.forEach(({ reject }) => reject(new DOMException("Cancelled due to endpoint release", "AbortError")));
            resolvers.clear();
            ep.removeEventListener("message", messageHandler);
            closeEndpoint(ep);
        }
    }
}
async function finalizeEndpoint(ep) {
    const newCount = (proxyCounter.get(ep) || 0) - 1;
    proxyCounter.set(ep, newCount);
    if (newCount === 0) {
        await releaseEndpoint(ep);
    }
}
const proxyCounter = new WeakMap();
const proxyFinalizers = "FinalizationRegistry" in globalThis
    ? new FinalizationRegistry(finalizeEndpoint)
    : undefined;
function registerProxy(proxy, ep) {
    const newCount = (proxyCounter.get(ep) || 0) + 1;
    proxyCounter.set(ep, newCount);
    proxyFinalizers?.register(proxy, ep, proxy);
}
function unregisterProxy(proxy) {
    proxyFinalizers?.unregister(proxy);
}
const proxyCaches = new Map();
export async function teardown(ep) {
    const proxyCache = proxyCaches.get(ep);
    if (!proxyCache) {
        return;
    }
    for (const proxy of proxyCache) {
        unregisterProxy(proxy);
    }
    proxyCache.clear();
    await releaseEndpoint(ep, true);
    proxyCaches.delete(ep);
}
function createProxy(ep, path = [], target = function () { }) {
    let proxyCache = proxyCaches.get(ep);
    if (proxyCache) {
        const cachedProxy = proxyCache.get(path.join(","));
        if (cachedProxy) {
            return cachedProxy;
        }
    }
    else {
        proxyCache = new Map();
        proxyCaches.set(ep, proxyCache);
    }
    let isProxyReleased = false;
    const proxy = new Proxy(target, {
        get(_target, prop) {
            if (prop === Symbol.dispose || prop === releaseProxy) {
                return () => {
                    isProxyReleased = true;
                    proxyCache.delete(path.join(","));
                    unregisterProxy(proxy);
                    releaseEndpoint(ep).catch(() => { }); // Can't await result in sync disposal. Error will be suppressed
                };
            }
            if (prop === Symbol.asyncDispose) {
                return async () => {
                    isProxyReleased = true;
                    proxyCache.delete(path.join(","));
                    unregisterProxy(proxy);
                    await releaseEndpoint(ep);
                };
            }
            throwIfProxyReleased(isProxyReleased);
            if (prop === "then") {
                if (path.length === 0) {
                    return { then: () => proxy };
                }
                const r = requestResponseMessage(ep, {
                    type: "GET" /* MessageType.GET */,
                    path: path.map((p) => p.toString()),
                }).then(fromWireValue.bind(ep));
                return r.then.bind(r);
            }
            const subProxy = createProxy(ep, [...path, prop]);
            proxyCache.set([...path, prop].join(","), subProxy);
            return subProxy;
        },
        set(_target, prop, rawValue) {
            throwIfProxyReleased(isProxyReleased);
            // FIXME: ES6 Proxy Handler `set` methods are supposed to return a
            // boolean. To show good will, we return true asynchronously ¯\_(ツ)_/¯
            const [value, transfer] = toWireValue.call(ep, rawValue);
            return requestResponseMessage(ep, {
                type: "SET" /* MessageType.SET */,
                path: [...path, prop].map((p) => p.toString()),
                value,
            }, transfer).then(fromWireValue.bind(ep));
        },
        apply(_target, _thisArg, rawArgumentList) {
            throwIfProxyReleased(isProxyReleased);
            const last = path[path.length - 1];
            if (last === createEndpoint) {
                const { port1, port2 } = new (ep[messageChannel] ?? MessageChannel)();
                requestResponseMessage(ep, {
                    type: "ENDPOINT" /* MessageType.ENDPOINT */,
                    value: port2,
                }, [port2]).catch(() => {
                    // XXX: Should these events be dispatched? Should they dispatch on the parent endpoint or the new port?
                    // port1.dispatchEvent(new MessageEvent('messageerror', { data: err }));
                    // ep.dispatchEvent(new ErrorEvent('error', { error: Error('Failed to create endpoint') }));
                    port1.close();
                });
                return port1;
            }
            // We just pretend that `bind()` didn’t happen.
            if (last === "bind") {
                const proxy = createProxy(ep, path.slice(0, -1));
                proxyCache.set(path.slice(0, -1).join(","), proxy);
                return proxy;
            }
            // Pretending that `call()` and `apply()` didn’t happen either
            if (last === "call") {
                path = path.slice(0, -1);
                rawArgumentList = rawArgumentList.slice(1);
            }
            if (last === "apply") {
                path = path.slice(0, -1);
                rawArgumentList = rawArgumentList[1];
            }
            const [argumentList, transfer] = processTuple(rawArgumentList, ep);
            return requestResponseMessage(ep, {
                type: "APPLY" /* MessageType.APPLY */,
                path: path.map((p) => p.toString()),
                argumentList,
            }, transfer).then(fromWireValue.bind(ep));
        },
        construct(_target, rawArgumentList) {
            throwIfProxyReleased(isProxyReleased);
            const [argumentList, transfer] = processTuple(rawArgumentList, ep);
            return requestResponseMessage(ep, {
                type: "CONSTRUCT" /* MessageType.CONSTRUCT */,
                path: path.map((p) => p.toString()),
                argumentList,
            }, transfer).then(fromWireValue.bind(ep));
        },
        has(_target, prop) {
            throwIfProxyReleased(isProxyReleased);
            // Can only check for known local properties, the rest can only be determined asynchronously, so we can only return `false` in that case.
            return (prop === Symbol.dispose ||
                prop === releaseProxy ||
                prop === Symbol.asyncDispose ||
                prop === createEndpoint ||
                prop === "then");
        },
    });
    if (path.length === 0) {
        // If the endpoint gets closed on us, we should mark the proxy as released and reject all pending promises.
        // This shouldn't really happen since the proxy must be closed from this side, either through manual dispose or finalization registry.
        // Also note that support for the `close` event is unclear (MDN doesn't document it, spec says it should be there...), so this is a last resort.
        ep.addEventListener("close", async (ev) => {
            //@ts-ignore
            isProxyReleased = ev.reason ?? "closed";
            await teardown(ep);
        });
        // Similarly, if the endpoint errors for any reason, we should mark the proxy as released and reject all pending promises.
        ep.addEventListener("error", async (ev) => {
            //@ts-ignore
            isProxyReleased = ev.error instanceof Error ? ev.error : "errored";
            await teardown(ep);
        });
    }
    registerProxy(proxy, ep);
    return proxy;
}
const flatten = "flat" in Array.prototype
    ? (arr) => arr.flat()
    : (arr) => Array.prototype.concat.apply([], arr);
function processTuple(argumentList, ep) {
    const processed = argumentList.map(toWireValue, ep);
    return [processed.map((v) => v[0]), flatten(processed.map((v) => v[1]))];
}
const transferCache = new WeakMap();
export function transfer(obj, transfers) {
    transferCache.set(obj, transfers);
    return obj;
}
export function proxy(obj) {
    const n = obj;
    n[proxyMarker] = true;
    return n;
}
export function windowEndpoint(w, context = globalThis, targetOrigin = "*") {
    return {
        postMessage: (msg, transfer) => w.postMessage(msg, targetOrigin, transfer),
        addEventListener: context.addEventListener.bind(context),
        removeEventListener: context.removeEventListener.bind(context),
    };
}
function toWireValue(value) {
    if (isReceiver(value)) {
        for (const [name, handler] of transferHandlers) {
            if (handler.canHandle(value, this)) {
                const [serializedValue, transfer] = handler.serialize(value, this);
                return [
                    {
                        type: "HANDLER" /* WireValueType.HANDLER */,
                        name,
                        value: serializedValue,
                    },
                    transfer,
                ];
            }
        }
    }
    return [
        {
            type: "RAW" /* WireValueType.RAW */,
            value,
        },
        transferCache.get(value) || [],
    ];
}
function fromWireValue(value) {
    switch (value.type) {
        case "HANDLER" /* WireValueType.HANDLER */:
            return transferHandlers.get(value.name).deserialize(value.value, this);
        case "RAW" /* WireValueType.RAW */:
            return value.value;
    }
}
const makeMessageHandler = (resolverMap) => (ev) => {
    const { data } = ev;
    if (!data?.id) {
        return;
    }
    const resolvers = resolverMap.get(data.id);
    if (!resolvers) {
        return;
    }
    resolverMap.delete(data.id);
    resolvers.resolve(data);
};
function requestResponseMessage(ep, msg, transfer) {
    return new Promise((resolve, reject) => {
        let resolvers = endpointState.get(ep)?.resolvers;
        if (!resolvers) {
            resolvers = new Map();
            const messageHandler = makeMessageHandler(resolvers);
            endpointState.set(ep, { resolvers, messageHandler });
            ep.addEventListener("message", messageHandler);
            ep.start?.();
        }
        const id = generateId();
        msg.id = id;
        resolvers.set(id, { resolve, reject });
        ep.postMessage(msg, transfer);
    });
}
function generateId() {
    return (Math.random() * 2 ** 32) >>> 0;
}
//# sourceMappingURL=caplink.js.map