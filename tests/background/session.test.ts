import { beforeEach, describe, expect, it, vi } from 'vitest';

function stubChrome(options: { saved?: unknown; offscreen: boolean; injectFails?: boolean }) {
  const session: Record<string, unknown> = options.saved ? { 'session-status': options.saved } : {};
  const chromeStub = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: session[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(session, items),
        remove: async (key: string) => delete session[key],
      },
    },
    runtime: {
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      getContexts: async () => (options.offscreen ? [{}] : []),
      sendMessage: vi.fn(async () => undefined),
    },
    offscreen: { closeDocument: vi.fn(async () => undefined) },
    action: { setBadgeText: vi.fn(async () => undefined) },
    tabs: { sendMessage: vi.fn(async () => undefined) },
    scripting: {
      executeScript: vi.fn(async () => {
        if (options.injectFails) throw new Error('no access');
      }),
    },
  };
  vi.stubGlobal('chrome', chromeStub);
  return { chromeStub, session };
}

describe('session status after the service worker restarts', () => {
  beforeEach(() => vi.resetModules());

  it('takes the saved status back while the offscreen document lives', async () => {
    stubChrome({ saved: { tabId: 7, state: 'listening' }, offscreen: true });
    const session = await import('../../src/background/session');
    await session.restored;
    expect(session.getStatus()).toEqual({ tabId: 7, state: 'listening' });
  });

  it('drops the saved status when the offscreen document is gone', async () => {
    const { session: storage } = stubChrome({ saved: { tabId: 7, state: 'listening' }, offscreen: false });
    const session = await import('../../src/background/session');
    await session.restored;
    expect(session.getStatus().state).toBe('off');
    expect(storage['session-status']).toBeUndefined();
  });

  it('injects the overlay again after the captured tab navigates', async () => {
    const { chromeStub } = stubChrome({ saved: { tabId: 7, state: 'listening' }, offscreen: true });
    const session = await import('../../src/background/session');
    await session.restored;
    await session.reinjectOverlay(8); // another tab: ignored
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
    await session.reinjectOverlay(7);
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('stops the session when the overlay cannot be injected', async () => {
    const { chromeStub } = stubChrome({ saved: { tabId: 7, state: 'listening' }, offscreen: true, injectFails: true });
    const session = await import('../../src/background/session');
    await session.restored;
    await session.reinjectOverlay(7);
    expect(session.getStatus().state).toBe('off');
    expect(chromeStub.offscreen.closeDocument).toHaveBeenCalled();
  });
});
