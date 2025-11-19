import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationPipelineRequest } from '../src/background';
import type { TranslationResponse } from '../src/shared/messages';
import type { TranslateVttMessage } from '../src/shared/messages';

const installChromeStub = (): void => {
  (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      lastError: undefined
    }
  } as unknown as typeof chrome;
};

describe('background service worker', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStub();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const loadBackgroundModule = async () => {
    const module = await import('../src/background');
    return module;
  };

  describe('runTranslationPipeline', () => {
    const sampleVtt = ['WEBVTT', '', '1', '00:00:01.000 --> 00:00:02.000 align:start', 'Bonjour Monde!', '', '2', '00:00:03.000 --> 00:00:04.000', 'Salut'].join(
      '\n'
    );

    it('returns translated VTT text when every step succeeds', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(sampleVtt)
      });
      const translateTextsFn = vi.fn().mockResolvedValue(['EN Bonjour', 'EN Salut']);
      const module = await loadBackgroundModule();
      const response = await module.runTranslationPipeline(
        { url: 'https://example.com/subs.vtt', sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn, translateTextsFn }
      );

      expect(fetchFn).toHaveBeenCalledWith('https://example.com/subs.vtt');
      expect(translateTextsFn).toHaveBeenCalledWith({
        texts: ['Bonjour Monde!', 'Salut'],
        sourceLanguage: 'fr',
        targetLanguage: 'en'
      });
      expect(response.status).toBe('translated');
      const success = response as Extract<TranslationResponse, { status: 'translated' }>;
      expect(success.translatedVtt).toContain('WEBVTT');
      expect(success.translatedVtt).toContain('EN Bonjour');
    });

    it('propagates HTTP errors with descriptive messages', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403 });
      const module = await loadBackgroundModule();
      const response = await module.runTranslationPipeline(
        { url: 'https://example.com/forbidden.vtt', sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn }
      );

      expect(response).toEqual({ status: 'error', message: 'Unable to download subtitles (403)' });
    });

    it('returns errors when the translation adapter output count mismatches the cue count', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(sampleVtt)
      });
      const translateTextsFn = vi.fn().mockResolvedValue(['only-one']);
      const module = await loadBackgroundModule();
      const response = await module.runTranslationPipeline(
        { url: 'https://example.com/bad.vtt', sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn, translateTextsFn }
      );

      expect(translateTextsFn).toHaveBeenCalled();
      expect(response.status).toBe('error');
    });

    it('handles network failures gracefully', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
      const module = await loadBackgroundModule();
      const response = await module.runTranslationPipeline(
        { url: 'https://example.com/offline.vtt', sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn }
      );

      expect(response).toEqual({ status: 'error', message: 'offline' });
    });
  });

  describe('createTranslateMessageHandler', () => {
    const buildRequest = (): TranslationPipelineRequest => ({
      url: 'https://example.com/subs.vtt',
      sourceLanguage: 'fr',
      targetLanguage: 'en'
    });

    const buildMessage = (): TranslateVttMessage => ({ type: 'TRANSLATE_VTT', ...buildRequest() });

    it('ignores unrelated messages', async () => {
      const module = await loadBackgroundModule();
      const handler = module.createTranslateMessageHandler();
      const sendResponse = vi.fn();
      const result = handler({ type: 'OTHER' }, { tab: undefined } as chrome.runtime.MessageSender, sendResponse);

      expect(result).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('rejects translation messages with missing parameters', async () => {
      const module = await loadBackgroundModule();
      const handler = module.createTranslateMessageHandler();
      const sendResponse = vi.fn();
      const invalidMessage = { type: 'TRANSLATE_VTT', url: '', sourceLanguage: 'fr', targetLanguage: '' } as TranslateVttMessage;

      const result = handler(invalidMessage, { tab: undefined } as chrome.runtime.MessageSender, sendResponse);

      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ status: 'error', message: 'Invalid translation request.' });
    });

    it('invokes the pipeline and resolves asynchronously', async () => {
      const module = await loadBackgroundModule();
      const pipeline = vi.fn().mockResolvedValue({ status: 'translated', translatedVtt: 'WEBVTT' });
      const handler = module.createTranslateMessageHandler({ pipeline });
      const sendResponse = vi.fn();

      const result = handler(buildMessage(), { tab: { url: 'https://arte.tv' } } as chrome.runtime.MessageSender, sendResponse);

      expect(result).toBe(true);
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({ status: 'translated', translatedVtt: 'WEBVTT' });
      });
    });

    it('returns error responses when the pipeline rejects', async () => {
      const module = await loadBackgroundModule();
      const pipeline = vi.fn().mockRejectedValue(new Error('fatal'));
      const handler = module.createTranslateMessageHandler({ pipeline });
      const sendResponse = vi.fn();

      handler(buildMessage(), { tab: undefined } as chrome.runtime.MessageSender, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({ status: 'error', message: 'fatal' });
      });
    });
  });
});
