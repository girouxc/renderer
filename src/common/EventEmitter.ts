/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IEventEmitter } from './IEventEmitter.js';

/**
 * EventEmitter base class
 */
export class EventEmitter implements IEventEmitter {
  /**
   * Lazily allocated on first `on`/`once` call. The vast majority of nodes in
   * a scene graph never have a listener attached, so deferring the map avoids
   * one object allocation per instance and keeps the hidden class smaller.
   * `null` means no listeners have ever been registered.
   */
  private eventListeners: { [eventName: string]: any } | null = null;

  on(event: string, listener: (target: any, data: any) => void): void {
    let map = this.eventListeners;
    if (map === null) {
      map = this.eventListeners = {};
    }
    let listeners = map[event];
    if (listeners === undefined) {
      listeners = [];
      map[event] = listeners;
    }
    listeners.push(listener);
  }

  off(event: string, listener?: (target: any, data: any) => void): void {
    const map = this.eventListeners;
    if (map === null) {
      return;
    }
    const listeners = map[event];
    if (listeners === undefined) {
      return;
    }
    if (listener === undefined) {
      map[event] = undefined;
      return;
    }
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  }

  once(event: string, listener: (target: any, data: any) => void): void {
    const onceListener = (target: any, data: any) => {
      this.off(event, onceListener);
      listener(target, data);
    };
    this.on(event, onceListener);
  }

  emit(event: string, data?: any): void {
    const map = this.eventListeners;
    if (map === null) {
      return;
    }
    const listeners = map[event];
    if (listeners === undefined) {
      return;
    }
    [...listeners].forEach((listener) => {
      listener(this, data);
    });
  }

  /**
   * Whether any listener is currently registered for any event.
   *
   * @remarks
   * Used as a liveness signal: a `Texture` with no listeners has no
   * `CoreNode` (or `SubTexture`) subscribed to it.
   */
  hasListeners(): boolean {
    const map = this.eventListeners;
    if (map === null) {
      return false;
    }
    for (const event in map) {
      const listeners = map[event];
      if (listeners !== undefined && listeners.length > 0) {
        return true;
      }
    }
    return false;
  }

  removeAllListeners() {
    this.eventListeners = null;
  }
}
