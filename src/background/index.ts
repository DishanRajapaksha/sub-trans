import { extensionBrowser } from '../shared/browser';
import { TranslateVttMessage, TranslationResponse, TranslationSuccessResponse } from '../shared/messages';
import { parseVtt, rebuildVtt, VttCue } from '../shared/vtt';
import { translateTexts } from '../shared/translation-adapter';

const log = (...args: unknown[]): void => {
  console.log('[Arte Subtitle Translator]', ...args);
};

extensionBrowser.runtime.onInstalled.addListener(() => {
  log('Background service worker installed.');
});

const buildSuccessResponse = (translatedVtt: string): TranslationSuccessResponse => ({
  status: 'translated',
  translatedVtt
});

type TranslationPipelineDeps = {
  fetchFn?: typeof fetch;
  parseVttFn?: (vttText: string) => VttCue[];
  rebuildVttFn?: (cues: VttCue[]) => string;
  translateTextsFn?: typeof translateTexts;
};

export type TranslationPipelineRequest = {
  url: string;
  sourceLanguage: string;
  targetLanguage: string;
};

export const runTranslationPipeline = async (
  request: TranslationPipelineRequest,
  deps: TranslationPipelineDeps = {}
): Promise<TranslationResponse> => {
  const fetchFn = deps.fetchFn ?? fetch;
  const parseVttFn = deps.parseVttFn ?? parseVtt;
  const rebuildVttFn = deps.rebuildVttFn ?? rebuildVtt;
  const translateTextsFn = deps.translateTextsFn ?? translateTexts;

  try {
    const response = await fetchFn(request.url);
    if (!response.ok) {
      const errorMessage = `Unable to download subtitles (${response.status})`;
      log(errorMessage, request.url);
      return { status: 'error', message: errorMessage };
    }

    const vttText = await response.text();
    const cues = parseVttFn(vttText);
    const texts = cues.map((cue) => cue.text);
    log('Starting translation pipeline for', request.url, 'with', texts.length, 'cues.');

    const translatedTexts = await translateTextsFn({
      texts,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage
    });

    if (translatedTexts.length !== cues.length) {
      const mismatchError = `Translation output count mismatch (expected ${cues.length}, received ${translatedTexts.length}).`;
      log(mismatchError, request.url);
      return { status: 'error', message: mismatchError };
    }

    const translatedCues = cues.map((cue, index) => ({
      ...cue,
      text: translatedTexts[index] ?? ''
    }));

    const translatedVtt = rebuildVttFn(translatedCues);
    log('Translation pipeline completed for', request.url);
    return buildSuccessResponse(translatedVtt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('Unexpected translation pipeline failure', message);
    return { status: 'error', message };
  }
};

type TranslateMessageHandlerDeps = {
  pipeline?: (request: TranslationPipelineRequest) => Promise<TranslationResponse>;
};

export const createTranslateMessageHandler = (deps: TranslateMessageHandlerDeps = {}) => {
  const pipeline = deps.pipeline ?? runTranslationPipeline;

  return (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: TranslationResponse) => void) => {
    if ((message as TranslateVttMessage)?.type !== 'TRANSLATE_VTT') {
      return undefined;
    }

    const { url, sourceLanguage, targetLanguage } = message as TranslateVttMessage;
    const hasRequiredFields = Boolean(url && sourceLanguage && targetLanguage);
    if (!hasRequiredFields) {
      log('Rejecting translation request due to missing parameters.', {
        url,
        sourceLanguage,
        targetLanguage
      });
      sendResponse({ status: 'error', message: 'Invalid translation request.' });
      return false;
    }

    log('Received translation request', {
      url,
      sourceLanguage,
      targetLanguage,
      sender: sender.tab?.url
    });

    pipeline({ url, sourceLanguage, targetLanguage })
      .then((response) => {
        if (response.status === 'translated') {
          log('Translation ready for', url);
        } else {
          log('Translation failed for', url, response.message);
        }
        sendResponse(response);
      })
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : String(error);
        log('Translation request handling threw', messageText);
        sendResponse({ status: 'error', message: messageText });
      });

    return true;
  };
};

const translateMessageHandler = createTranslateMessageHandler();

extensionBrowser.runtime.onMessage.addListener(translateMessageHandler);
