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
import { Endpoint, MessageEventTarget, PostMessageWithOrigin, messageChannel, toNative, adoptNative } from "./protocol.js";
export type { Endpoint, MessageEventTarget, PostMessageWithOrigin };
export declare const proxyMarker: unique symbol;
export declare const createEndpoint: unique symbol;
/** @deprecated Use `Symbol.dispose` or `Symbol.asyncDispose` instead */
export declare const releaseProxy: unique symbol;
/** @deprecated Use `Symbol.dispose` or `Symbol.asyncDispose` instead */
export declare const finalizer: unique symbol;
export { messageChannel, toNative, adoptNative };
/**
 * Interface of values that were marked to be proxied with `caplink.proxy()`.
 * Can also be implemented by classes.
 */
export interface ProxyMarked {
    [proxyMarker]: true;
}
/**
 * Takes a type and wraps it in a Promise, if it not already is one.
 * This is to avoid `Promise<Promise<T>>`.
 *
 * This is the inverse of `Unpromisify<T>`.
 */
type Promisify<T> = T extends PromiseLike<unknown> ? T : Promise<T>;
/**
 * Takes the raw type of a remote property and returns the type that is visible to the local thread on the proxy.
 *
 * Note: This needs to be its own type alias, otherwise it will not distribute over unions.
 * See https://www.typescriptlang.org/docs/handbook/advanced-types.html#distributive-conditional-types
 */
type RemoteProperty<T> = T extends Function | ProxyMarked ? Remote<T> : Promisify<T>;
/**
 * Takes the raw type of a property as a remote thread would see it through a proxy (e.g. when passed in as a function
 * argument) and returns the type that the local thread has to supply.
 *
 * This is the inverse of `RemoteProperty<T>`.
 *
 * Note: This needs to be its own type alias, otherwise it will not distribute over unions. See
 * https://www.typescriptlang.org/docs/handbook/advanced-types.html#distributive-conditional-types
 */
type LocalProperty<T> = T extends Function | ProxyMarked ? Local<T> : Awaited<T>;
/**
 * Proxies `T` if it is a `ProxyMarked`, clones it otherwise (as handled by structured cloning and transfer handlers).
 */
export type ProxyOrClone<T> = T extends ProxyMarked ? Remote<T> : T;
/**
 * Inverse of `ProxyOrClone<T>`.
 */
export type UnproxyOrClone<T> = T extends Remote<infer U> ? (U & ProxyMarked) | Remote<U> : T extends RemoteObject<ProxyMarked> ? Local<T> : T;
/**
 * Takes the raw type of a remote object in the other thread and returns the type as it is visible to the local thread
 * when proxied with `Caplink.proxy()`.
 *
 * This does not handle call signatures, which is handled by the more general `Remote<T>` type.
 *
 * @template T The raw type of a remote object as seen in the other thread.
 */
export type RemoteObject<T> = {
    [P in keyof T as Exclude<P, symbol>]: RemoteProperty<T[P]>;
};
/**
 * Takes the type of an object as a remote thread would see it through a proxy (e.g. when passed in as a function
 * argument) and returns the type that the local thread has to supply.
 *
 * This does not handle call signatures, which is handled by the more general `Local<T>` type.
 *
 * This is the inverse of `RemoteObject<T>`.
 *
 * @template T The type of a proxied object.
 */
export type LocalObject<T> = {
    [P in keyof T]: LocalProperty<T[P]>;
};
/**
 * Additional special caplink methods available on each proxy returned by `Caplink.wrap()`.
 */
export interface ProxyMethods {
    [createEndpoint]: () => MessagePort;
    [Symbol.dispose]: () => void;
    [Symbol.asyncDispose]: () => Promise<void>;
    /** @deprecated Use `Symbol.dispose` or `Symbol.asyncDispose` instead */
    [releaseProxy]: () => Promise<void>;
}
/**
 * Takes the raw type of a remote object, function or class in the other thread and returns the type as it is visible to
 * the local thread from the proxy return value of `Caplink.wrap()` or `Caplink.proxy()`.
 */
export type Remote<T> = RemoteObject<T> & (T extends (...args: infer TArguments) => infer TReturn ? (...args: {
    [I in keyof TArguments]: UnproxyOrClone<TArguments[I]>;
}) => Promisify<ProxyOrClone<Awaited<TReturn>>> : unknown) & (T extends {
    new (...args: infer TArguments): infer TInstance;
} ? {
    new (...args: {
        [I in keyof TArguments]: UnproxyOrClone<TArguments[I]>;
    }): Promisify<Remote<TInstance>>;
} : unknown) & ProxyMethods;
/**
 * Expresses that a type can be either a sync or async.
 */
type MaybePromise<T> = PromiseLike<T> | T;
/**
 * Takes the raw type of a remote object, function or class as a remote thread would see it through a proxy (e.g. when
 * passed in as a function argument) and returns the type the local thread has to supply.
 *
 * This is the inverse of `Remote<T>`. It takes a `Remote<T>` and returns its original input `T`.
 */
export type Local<T> = Omit<LocalObject<T>, keyof ProxyMethods> & (T extends (...args: infer TArguments) => infer TReturn ? (...args: {
    [I in keyof TArguments]: ProxyOrClone<TArguments[I]>;
}) => MaybePromise<UnproxyOrClone<Awaited<TReturn>>> : unknown) & (T extends {
    new (...args: infer TArguments): infer TInstance;
} ? {
    new (...args: {
        [I in keyof TArguments]: ProxyOrClone<TArguments[I]>;
    }): MaybePromise<Local<Awaited<TInstance>>>;
} : unknown);
type TransferableTuple<T> = [value: T, transfer: Transferable[]];
/**
 * Customizes the serialization of certain values as determined by `canHandle()`.
 *
 * @template T The input type being handled by this transfer handler.
 * @template S The serialized type sent over the wire.
 */
export interface TransferHandler<T extends object | Function, S> {
    /**
     * Gets called for every value to determine whether this transfer handler
     * should serialize the value, which includes checking that it is of the right
     * type (but can perform checks beyond that as well).
     */
    canHandle(value: object | Function, ep: Endpoint): value is T;
    /**
     * Gets called with the value if `canHandle()` returned `true` to produce a
     * value that can be sent in a message, consisting of structured-cloneable
     * values and/or transferrable objects.
     */
    serialize(value: T, ep: Endpoint): TransferableTuple<S>;
    /**
     * Gets called to deserialize an incoming value that was serialized in the
     * other thread with this transfer handler (known through the name it was
     * registered under).
     */
    deserialize(value: S, ep: Endpoint): T;
}
/**
 * Allows customizing the serialization of certain values.
 */
export declare const transferHandlers: Map<string, TransferHandler<object | Function, unknown>>;
export declare function expose(object: object, ep?: Endpoint, allowedOrigins?: (string | RegExp)[]): void;
export declare function wrap<T>(ep: Endpoint, target?: any): Remote<T>;
export declare function teardown(ep: Endpoint): Promise<void>;
export declare function transfer<T>(obj: T, transfers: Transferable[]): T;
export declare function proxy<T extends {}>(obj: T): T & ProxyMarked;
export declare function windowEndpoint(w: PostMessageWithOrigin, context?: MessageEventTarget, targetOrigin?: string): Endpoint;
