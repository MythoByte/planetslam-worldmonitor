import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initTestI18n } from './helpers/i18n.mts';
const player = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@/services/live-video/session', () => ({ openLiveVideo: player.open }));
import { SpaceCamerasPanel } from '@/components/SpaceCamerasPanel';

beforeAll(initTestI18n);
afterEach(() => { vi.useRealTimers(); localStorage.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); player.open.mockReset(); });

describe('Space camera playback lifecycle', () => {
  it('ignores malformed saved favorites instead of breaking panel construction', () => {
    localStorage.setItem('planetslam-space-camera-favorites-v1', '{"unexpected":true}');
    const panel = new SpaceCamerasPanel();
    expect(panel.getElement().querySelectorAll('[data-camera-favorite]')).toHaveLength(3);
    panel.destroy();
  });

  it('does not repeatedly resume a player the viewer paused and destroys sessions', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const session = { setPaused: vi.fn(), destroy: vi.fn() };
    player.open.mockReturnValue(session);
    const panel = new SpaceCamerasPanel();
    document.body.append(panel.getElement()); panel.notifyConnected();
    panel.getElement().querySelector<HTMLButtonElement>('[data-camera-play="starbase"]')!.click();
    expect(player.open).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(8000);
    expect(session.setPaused).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.advanceTimersByTime(4000);
    expect(session.setPaused.mock.calls).toEqual([[true]]);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.advanceTimersByTime(4000);
    expect(session.setPaused.mock.calls).toEqual([[true], [false]]);
    panel.destroy();
    expect(session.destroy).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(4000);
    expect(session.setPaused).toHaveBeenCalledTimes(2);
  });
});
