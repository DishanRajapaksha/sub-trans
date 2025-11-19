import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as contentModule from './index';
import { sendRuntimeMessage } from '../shared/browser';

vi.mock('../shared/browser', () => {
  return {
    sendRuntimeMessage: vi.fn()
  };
});

const sendRuntimeMessageMock = vi.mocked(sendRuntimeMessage);

const getConsoleSpy = () => vi.spyOn(console, 'log').mockImplementation(() => {});

const arteVideoPageUrl =
  'https://www.arte.tv/fr/videos/117798-000-A/tous-accros-le-piege-des-aliments-ultratransformes/';
const arteSubtitleUrl =
  'https://arte-cmafhls.akamaized.net/am/cmaf/117000/117700/117798-000-A/2025041410B51FCA52FE154899808A47149B6438F3/medias/117798-000-A_st_VF-MAL.vtt?CMCD=br%3D4816%2Ccid%3D%22-158067677%22%2Cdl%3D0%2Cmtp%3D69900%2Cnor%3D%22undefined%22%2Cot%3Dc%2Csf%3Dh%2Csid%3D%222b8942f7-9156-4d2d-bf47-510cfafd6d04%22%2Cst%3Dv%2Ctb%3D4816';

describe('content script bootstrap utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('waitForVideo', () => {
    it('returns an existing video immediately', async () => {
      const video = document.createElement('video');
      document.body.append(video);

      await expect(contentModule.waitForVideo()).resolves.toBe(video);
    });

    it('resolves when a video is inserted via mutations and clears the timeout', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
      const pending = contentModule.waitForVideo();
      const video = document.createElement('video');
      video.dataset.arteVideoPage = arteVideoPageUrl;
      document.body.append(video);

      await expect(pending).resolves.toBe(video);
      expect(clearTimeoutSpy).toHaveBeenCalled();
      vi.useRealTimers();
      clearTimeoutSpy.mockRestore();
    });

    it('times out when no video is found', async () => {
      vi.useFakeTimers();
      const pending = contentModule.waitForVideo();

      vi.advanceTimersByTime(10_000);
      await expect(pending).resolves.toBeNull();
      vi.useRealTimers();
    });

    it('ignores mutations that do not introduce a video', async () => {
      vi.useFakeTimers();
      const pending = contentModule.waitForVideo();
      const placeholder = document.createElement('div');
      document.body.append(placeholder);

      await Promise.resolve();
      vi.runOnlyPendingTimers();
      await expect(pending).resolves.toBeNull();
      vi.useRealTimers();
    });
  });

  describe('isFrenchTrack', () => {
    it('accepts tracks with srclang fr and subtitle kind', () => {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'fr';

      expect(contentModule.isFrenchTrack(track)).toBe(true);
    });

    it('accepts tracks when srclang is a regional French variant', () => {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'fr-FR';

      expect(contentModule.isFrenchTrack(track)).toBe(true);
    });

    it('accepts tracks whose labels mention fr regardless of case', () => {
      const track = document.createElement('track');
      track.kind = 'captions';
      track.label = 'FRançais';

      expect(contentModule.isFrenchTrack(track)).toBe(true);
    });

    it('accepts tracks that label the audio as VF (Version Française)', () => {
      const track = document.createElement('track');
      track.kind = 'captions';
      track.label = 'VF - MAL';

      expect(contentModule.isFrenchTrack(track)).toBe(true);
    });

    it('rejects other tracks', () => {
      const track = document.createElement('track');
      track.kind = 'metadata';
      track.srclang = 'en';

      expect(contentModule.isFrenchTrack(track)).toBe(false);
    });

    it('treats undefined srclang as empty text', () => {
      const track = {
        kind: 'captions',
        label: 'FR',
        srclang: undefined
      } as unknown as HTMLTrackElement;

      expect(contentModule.isFrenchTrack(track)).toBe(true);
    });

    it('treats undefined labels as empty text', () => {
      const track = {
        kind: 'subtitles',
        srclang: 'fr',
        label: undefined
      } as unknown as HTMLTrackElement;

      expect(contentModule.isFrenchTrack(track)).toBe(true);
    });
  });

  describe('waitForFrenchTrack', () => {
    it('returns an already existing French track', async () => {
      const video = document.createElement('video');
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'fr';
      track.src = arteSubtitleUrl;
      video.append(track);
      document.body.append(video);

      await expect(contentModule.waitForFrenchTrack(video)).resolves.toBe(track);
    });

    it('resolves after track mutations and clears the timeout', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
      const video = document.createElement('video');
      document.body.append(video);

      const pending = contentModule.waitForFrenchTrack(video);
      const track = document.createElement('track');
      track.kind = 'captions';
      track.label = 'VF - MAL';
      track.src = arteSubtitleUrl;
      video.append(track);

      await expect(pending).resolves.toBe(track);
      expect(clearTimeoutSpy).toHaveBeenCalled();
      vi.useRealTimers();
      clearTimeoutSpy.mockRestore();
    });

    it('times out when no matching track appears', async () => {
      const video = document.createElement('video');
      document.body.append(video);

      vi.useFakeTimers();
      const pending = contentModule.waitForFrenchTrack(video);
      vi.advanceTimersByTime(10_000);
      await expect(pending).resolves.toBeNull();
      vi.useRealTimers();
    });

    it('ignores subtitle tracks that are not French', async () => {
      const video = document.createElement('video');
      document.body.append(video);

      vi.useFakeTimers();
      const pending = contentModule.waitForFrenchTrack(video);
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'en';
      video.append(track);

      await Promise.resolve();
      vi.runOnlyPendingTimers();
      await expect(pending).resolves.toBeNull();
      vi.useRealTimers();
    });
  });

  describe('requestTranslation', () => {
    it('logs when the src attribute is missing', async () => {
      const consoleSpy = getConsoleSpy();
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'fr';

      await contentModule.requestTranslation(track);

      expect(sendRuntimeMessageMock).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[Arte Subtitle Translator]', 'French track does not expose a src attribute.');
    });

    it('sends a translation message when src exists', async () => {
      const consoleSpy = getConsoleSpy();
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'fr';
      track.src = arteSubtitleUrl;

      sendRuntimeMessageMock.mockResolvedValue(undefined);

      await contentModule.requestTranslation(track);

      expect(sendRuntimeMessageMock).toHaveBeenCalledWith({
        type: 'TRANSLATE_VTT',
        url: arteSubtitleUrl,
        sourceLanguage: 'fr',
        targetLanguage: 'en'
      });
      expect(consoleSpy).toHaveBeenCalledWith('[Arte Subtitle Translator]', 'Sent translation request for', track.src);
    });

    it('logs failures when runtime messaging rejects', async () => {
      const consoleSpy = getConsoleSpy();
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'fr';
      track.src = arteSubtitleUrl;

      sendRuntimeMessageMock.mockRejectedValue(new Error('nope'));

      await contentModule.requestTranslation(track);

      expect(consoleSpy).toHaveBeenCalledWith('[Arte Subtitle Translator]', 'Failed to send translation request', expect.any(Error));
    });
  });

  describe('bootstrap', () => {
    it('logs and exits when no video exists', async () => {
      const consoleSpy = getConsoleSpy();
      const waitForVideoFn = vi.fn().mockResolvedValue(null);

      await contentModule.bootstrap({ waitForVideoFn });

      expect(waitForVideoFn).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[Arte Subtitle Translator]', 'No <video> element detected on this page.');
    });

    it('logs when no French track can be located', async () => {
      const consoleSpy = getConsoleSpy();
      const video = document.createElement('video');
      const waitForVideoFn = vi.fn().mockResolvedValue(video);
      const waitForFrenchTrackFn = vi.fn().mockResolvedValue(null);

      await contentModule.bootstrap({ waitForVideoFn, waitForFrenchTrackFn });

      expect(consoleSpy).toHaveBeenCalledWith('[Arte Subtitle Translator]', 'Video element detected. Searching for subtitle tracks...');
      expect(consoleSpy).toHaveBeenCalledWith('[Arte Subtitle Translator]', 'No French subtitle track discovered.');
    });

    it('requests translation when prerequisites are met', async () => {
      const consoleSpy = getConsoleSpy();
      const video = document.createElement('video');
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'fr';
      track.src = 'https://example.com/ready.vtt';
      const waitForVideoFn = vi.fn().mockResolvedValue(video);
      const waitForFrenchTrackFn = vi.fn().mockResolvedValue(track);
      const requestSpy = vi.fn().mockResolvedValue(undefined);

      await contentModule.bootstrap({
        waitForVideoFn,
        waitForFrenchTrackFn,
        requestTranslationFn: requestSpy
      });

      expect(consoleSpy).toHaveBeenCalledWith('[Arte Subtitle Translator]', 'French subtitle track found.');
      expect(requestSpy).toHaveBeenCalledWith(track);
    });

    it('logs when a translation request rejects', async () => {
      const consoleSpy = getConsoleSpy();
      const video = document.createElement('video');
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = 'fr';
      track.src = 'https://example.com/failure.vtt';
      const waitForVideoFn = vi.fn().mockResolvedValue(video);
      const waitForFrenchTrackFn = vi.fn().mockResolvedValue(track);
      const requestSpy = vi.fn().mockRejectedValue(new Error('boom'));

      await contentModule.bootstrap({
        waitForVideoFn,
        waitForFrenchTrackFn,
        requestTranslationFn: requestSpy
      });

      await Promise.resolve();
      expect(consoleSpy).toHaveBeenCalledWith('[Arte Subtitle Translator]', 'Unhandled translation request error', expect.any(Error));
    });
  });

  describe('maybeBootstrap', () => {
    it('does not invoke bootstrap when auto bootstrap is disabled', () => {
      const bootstrapFn = vi.fn();

      contentModule.maybeBootstrap({
        bootstrapFn,
        shouldAutoBootstrapFn: () => false
      });

      expect(bootstrapFn).not.toHaveBeenCalled();
    });

    it('invokes bootstrap when auto bootstrap is enabled', () => {
      const bootstrapFn = vi.fn();

      contentModule.maybeBootstrap({
        bootstrapFn,
        shouldAutoBootstrapFn: () => true
      });

      expect(bootstrapFn).toHaveBeenCalled();
    });
  });
});
