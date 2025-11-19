import { extensionBrowser } from '../shared/browser';
import { TranslateVttMessage, TranslationResponse, TranslationSuccessResponse } from '../shared/messages';

const log = (...args: unknown[]): void => {
  console.log('[Arte Subtitle Translator]', ...args);
};

extensionBrowser.runtime.onInstalled.addListener(() => {
  log('Background service worker installed.');
});

const convertVttToTranslatedPlaceholder = (vttText: string): string => {
  const lines = vttText.split(/\r?\n/);
  let awaitingCueText = false;

  const converted = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      awaitingCueText = false;
      return line;
    }

    if (trimmed.startsWith('WEBVTT')) {
      awaitingCueText = false;
      return line;
    }

    if (line.includes('-->')) {
      awaitingCueText = true;
      return line;
    }

    if (!awaitingCueText) {
      // Cue identifier or non-cue metadata. Preserve it untouched.
      return line;
    }

    return 'TRANSLATED';
  });

  return converted.join('\n');
};

const buildSuccessResponse = (translatedVtt: string): TranslationSuccessResponse => ({
  status: 'translated',
  translatedVtt
});

const translateVttFromUrl = async (url: string): Promise<TranslationResponse> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorMessage = `Unable to download subtitles: ${response.status}`;
      log(errorMessage, url);
      return { status: 'error', message: errorMessage };
    }

    const vttText = await response.text();
    const translatedVtt = convertVttToTranslatedPlaceholder(vttText);
    return buildSuccessResponse(translatedVtt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('Unexpected translation pipeline failure', message);
    return { status: 'error', message };
  }
};

extensionBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message as TranslateVttMessage)?.type !== 'TRANSLATE_VTT') {
    return undefined;
  }

  const { url, sourceLanguage, targetLanguage } = message as TranslateVttMessage;
  log('Received translation request', {
    url,
    sourceLanguage,
    targetLanguage,
    sender: sender.tab?.url
  });

  translateVttFromUrl(url)
    .then((response) => {
      if (response.status === 'translated') {
        log('Translation placeholder ready for', url);
      } else {
        log('Translation placeholder failed for', url, response.message);
      }
      sendResponse(response);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log('Translation request handling threw', message);
      sendResponse({ status: 'error', message } satisfies TranslationResponse);
    });

  return true;
});
