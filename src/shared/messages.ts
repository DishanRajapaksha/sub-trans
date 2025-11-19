export type TranslateVttMessage = {
  type: 'TRANSLATE_VTT';
  url: string;
  sourceLanguage: string;
  targetLanguage: string;
};

export type TranslationSuccessResponse = {
  status: 'translated';
  translatedVtt: string;
  mapping?: Record<string, string>;
};

export type TranslationErrorResponse = {
  status: 'error';
  message: string;
};

export type TranslationResponse = TranslationSuccessResponse | TranslationErrorResponse;
