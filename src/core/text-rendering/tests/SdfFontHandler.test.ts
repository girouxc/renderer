import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFont } from '../SdfFontHandler.js';
import { EventEmitter } from '../../../common/EventEmitter.js';
import { TextureError, TextureErrorCode } from '../../TextureError.js';
import type { Stage } from '../../Stage.js';

// Minimal XHR stand-in: synchronously delivers valid SDF font JSON so loadFont
// proceeds to create the atlas texture and attach its event listeners.
class FakeXHR {
  status = 200;
  response: unknown = null;
  responseType = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open(): void {}
  send(): void {
    this.response = { chars: [{}] };
    if (this.onload !== null) {
      this.onload();
    }
  }
}

// A texture is just an EventEmitter to loadFont; stub the few props it reads.
function makeFakeTexture() {
  const tex = new EventEmitter() as unknown as EventEmitter & {
    state: string;
    preventCleanup: boolean;
    setRenderableOwner: (owner: string, val: boolean) => void;
  };
  tex.state = 'loading'; // not 'loaded' -> goes through the listener path
  tex.preventCleanup = false;
  tex.setRenderableOwner = () => {};
  return tex;
}

// Drain microtasks + one macrotask so the async loader reaches listener setup.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('SdfFontHandler loadFont — failed event argument', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let originalXHR: unknown;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalXHR = (globalThis as unknown as { XMLHttpRequest: unknown })
      .XMLHttpRequest;
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
      FakeXHR;
  });

  afterEach(() => {
    errSpy.mockRestore();
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
      originalXHR;
  });

  it('rejects with the TextureError (second emit arg), not the emitting texture', async () => {
    const tex = makeFakeTexture();
    const stage = {
      txManager: { createTexture: () => tex },
    } as unknown as Stage;

    const promise = loadFont(stage, {
      fontFamily: 'TestSdfFailFont',
      atlasUrl: 'atlas.png',
      atlasDataUrl: 'atlas.json',
    } as Parameters<typeof loadFont>[1]);

    await flush();

    const error = new TextureError(
      TextureErrorCode.TEXTURE_UPLOAD_FAILED,
      'boom',
    );

    // Attach the rejection assertion before emitting so the handler is ready.
    const assertion = expect(promise).rejects.toBe(error);

    // EventEmitter calls listeners as (target, data) -> (tex, error).
    tex.emit('failed', error);

    await assertion;
  });

  it('logs the error, not the texture, on failure', async () => {
    const tex = makeFakeTexture();
    const stage = {
      txManager: { createTexture: () => tex },
    } as unknown as Stage;

    const promise = loadFont(stage, {
      fontFamily: 'TestSdfFailFontLog',
      atlasUrl: 'atlas.png',
      atlasDataUrl: 'atlas.json',
    } as Parameters<typeof loadFont>[1]);

    await flush();

    const error = new TextureError(
      TextureErrorCode.TEXTURE_UPLOAD_FAILED,
      'boom',
    );
    const rejected = promise.catch(() => {});
    tex.emit('failed', error);
    await rejected;

    const lastCall = errSpy.mock.calls[errSpy.mock.calls.length - 1]!;
    expect(lastCall[1]).toBe(error);
    expect(lastCall[1]).not.toBe(tex);
  });
});
