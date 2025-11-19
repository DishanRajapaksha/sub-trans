import { extensionBrowser } from '../shared/browser';

type TranslateVttMessage = {
  type: 'TRANSLATE_VTT';
  url: string;
  sourceLanguage: string;
  targetLanguage: string;
};

type TranslationAck = {
  status: 'received';
};

const log = (...args: unknown[]): void => {
  console.log('[Arte Subtitle Translator]', ...args);
};

extensionBrowser.runtime.onInstalled.addListener(() => {
  log('Background service worker installed.');
});

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

  const response: TranslationAck = { status: 'received' };
  sendResponse(response);
  return true;
});
