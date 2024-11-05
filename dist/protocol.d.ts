/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TypedEventTarget } from "typed-event-target";
export interface MessageEventTargetEventMap extends Readonly<Event>, MessagePortEventMap {
    error: ErrorEvent;
    close: CloseEvent;
}
export type MessageEventTarget = Pick<TypedEventTarget<MessageEventTargetEventMap>, "addEventListener" | "removeEventListener">;
export declare const messageChannel: unique symbol;
export declare const adoptNative: unique symbol;
export declare const toNative: unique symbol;
export interface PostMessageWithOrigin {
    postMessage(message: any, targetOrigin: string, transfer?: Transferable[]): void;
}
export interface Endpoint extends MessageEventTarget {
    postMessage(message: any, transfer?: Transferable[] | StructuredSerializeOptions): void;
    start?: () => void;
    [messageChannel]?: typeof MessageChannel;
    [adoptNative]?: (port: MessagePort) => MessagePort;
    [toNative]?: () => MessagePort;
}
export declare const enum WireValueType {
    RAW = "RAW",
    PROXY = "PROXY",
    THROW = "THROW",
    HANDLER = "HANDLER"
}
export type MessageId = string | number;
export interface RawWireValue {
    id?: MessageId;
    type: WireValueType.RAW;
    value: unknown;
}
export interface HandlerWireValue {
    id?: MessageId;
    type: WireValueType.HANDLER;
    name: string;
    value: unknown;
}
export type WireValue = RawWireValue | HandlerWireValue;
export declare const enum MessageType {
    GET = "GET",
    SET = "SET",
    APPLY = "APPLY",
    CONSTRUCT = "CONSTRUCT",
    ENDPOINT = "ENDPOINT",
    RELEASE = "RELEASE"
}
export interface GetMessage {
    id?: MessageId;
    type: MessageType.GET;
    path: string[];
}
export interface SetMessage {
    id?: MessageId;
    type: MessageType.SET;
    path: string[];
    value: WireValue;
}
export interface ApplyMessage {
    id?: MessageId;
    type: MessageType.APPLY;
    path: string[];
    argumentList: WireValue[];
}
export interface ConstructMessage {
    id?: MessageId;
    type: MessageType.CONSTRUCT;
    path: string[];
    argumentList: WireValue[];
}
export interface EndpointMessage {
    id?: MessageId;
    type: MessageType.ENDPOINT;
    value: MessagePort;
}
export interface ReleaseMessage {
    id?: MessageId;
    type: MessageType.RELEASE;
}
export type Message = GetMessage | SetMessage | ApplyMessage | ConstructMessage | EndpointMessage | ReleaseMessage;
