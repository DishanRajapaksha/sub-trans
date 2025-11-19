import { extensionBrowser } from '../shared/browser';
import { TranslateVttMessage, TranslationResponse, TranslationSuccessResponse } from '../shared/messages';
import { parseVttWithHeader, rebuildVttWithHeader, VttDocument } from '../shared/vtt';
import { extractPlainText, replaceTextPreservingTags, convertVttToHtml } from '../shared/vtt-styling';
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
  parseVttFn?: (vttText: string) => VttDocument;
  rebuildVttFn?: (header: string, cues: VttDocument['cues']) => string;
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
  const parseVttFn = deps.parseVttFn ?? parseVttWithHeader;
  const rebuildVttFn = deps.rebuildVttFn ?? rebuildVttWithHeader;
  const translateTextsFn = deps.translateTextsFn ?? translateTexts;

  try {
    const response = await fetchFn(request.url);
    if (!response.ok) {
      const errorMessage = `Unable to download subtitles (${response.status})`;
      log(errorMessage, request.url);
      return { status: 'error', message: errorMessage };
    }

    const vttText = await response.text();
    const { header, cues } = parseVttFn(vttText);

    // Extract plain text from cues (removing VTT styling tags)
    const plainTexts = cues.map((cue) => extractPlainText(cue.text));
    log('Starting translation pipeline for', request.url, 'with', plainTexts.length, 'cues.');

    const translatedTexts = await translateTextsFn({
      texts: plainTexts,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage
    });

    if (translatedTexts.length !== cues.length) {
      const mismatchError = `Translation output count mismatch (expected ${cues.length}, received ${translatedTexts.length}).`;
      log(mismatchError, request.url);
      return { status: 'error', message: mismatchError };
    }

    // Replace text while preserving original VTT styling tags
    const translatedCues = cues.map((cue, index) => ({
      ...cue,
      text: replaceTextPreservingTags(cue.text, translatedTexts[index] ?? '')
    }));

    // Create a mapping of Original Text -> Translated Text
    // We normalize the original text (trim, collapse spaces) to match what we'll find in the DOM
    const mapping: Record<string, string> = {};
    cues.forEach((cue, index) => {
      // Extract plain text for the key (since DOM might not have tags)
      const plainOriginal = plainTexts[index].replace(/\s+/g, ' ').trim();
      // The value should be the translated text converted to HTML with styling tags
      // This allows us to replace innerHTML in the DOM while preserving styling
      const translatedHtml = convertVttToHtml(translatedCues[index].text);

      if (plainOriginal && translatedHtml) {
        mapping[plainOriginal] = translatedHtml;
      }
    });

    // Log first cue comparison for debugging
    if (cues.length > 0) {
      log('=== CUE COMPARISON (first cue) ===');
      log('Original text:', cues[0].text);
      log('Plain text extracted:', plainTexts[0]);
      log('Translated plain text:', translatedTexts[0]);
      log('Final text with tags:', translatedCues[0].text);
      log('===================================');
    }

    const translatedVtt = rebuildVttFn(header, translatedCues);
    log('Translation pipeline completed for', request.url);
    log('Header preview:', header.substring(0, 200));
    log('Translated VTT preview:', translatedVtt.substring(0, 500));

    return {
      status: 'translated',
      translatedVtt,
      mapping
    };
  } catch (error) {
    log('Translation pipeline failed:', error);
    return { status: 'error', message: String(error) };
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

// Track active and completed translations to prevent duplicates
const translationPromises = new Map<string, Promise<TranslationResponse>>();

// Intercept VTT subtitle requests and pre-translate them
extensionBrowser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;

    // Check if this is a French VTT file from ARTE
    if (url.includes('.vtt') && url.includes('arte-cmafhls.akamaized.net')) {
      // Check if it's a French subtitle (VF = Version Française)
      if (url.includes('_st_VF') || url.includes('_VF-')) {
        const baseUrl = url.split('?')[0];

        // Check if we're already handling this URL
        if (translationPromises.has(baseUrl)) {
          log('Request for already handled VTT:', baseUrl);
          // If it's already done, we might want to resend the result to the tab
          // in case the content script missed it (e.g. page reload)
          translationPromises.get(baseUrl)?.then((response) => {
            if (response.status === 'translated') {
              extensionBrowser.tabs.query({ url: 'https://www.arte.tv/*' }).then((tabs) => {
                tabs.forEach((tab) => {
                  if (tab.id) {
                    extensionBrowser.tabs.sendMessage(tab.id, {
                      type: 'VTT_TRANSLATED',
                      url: url,
                      translatedVtt: response.translatedVtt,
                      mapping: response.mapping
                    }).catch(() => { });
                  }
                });
              });
            }
          });
          return {};
        }

        log('Detected new French VTT request:', url);

        // Create and store the translation promise
        const promise = runTranslationPipeline({
          url: url,
          sourceLanguage: 'fr',
          targetLanguage: 'en'
        });

        translationPromises.set(baseUrl, promise);

        promise.then((response) => {
          if (response.status === 'translated') {
            log('Translation completed, sending to content script:', url);

            // Send translated VTT to all ARTE tabs
            extensionBrowser.tabs.query({ url: 'https://www.arte.tv/*' }).then((tabs) => {
              tabs.forEach((tab) => {
                if (tab.id) {
                  extensionBrowser.tabs.sendMessage(tab.id, {
                    type: 'VTT_TRANSLATED',
                    url: url,
                    translatedVtt: response.translatedVtt,
                    mapping: response.mapping
                  }).catch(() => {
                    // Content script might not be ready yet
                  });
                }
              });
            });
          } else {
            // If failed, remove from cache so we can try again later
            translationPromises.delete(baseUrl);
          }
        }).catch((error) => {
          log('Translation failed:', error);
          translationPromises.delete(baseUrl);
        });
      }
    }

    return {}; // Don't block the request
  },
  { urls: ['https://arte-cmafhls.akamaized.net/*'] }
);
