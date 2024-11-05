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
/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Endpoint } from "./protocol.ts";
export interface NodeEndpoint {
    postMessage(message: any, transfer?: any[]): void;
    on(type: string, listener: (value: any) => void): void;
    off(type: string, listener: (value: any) => void): void;
    start?: () => void;
}
export default function nodeEndpoint(nep: Endpoint | NodeEndpoint): Endpoint;
