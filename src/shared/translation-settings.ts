export const SUPPORTED_TRANSLATION_PROVIDERS = ['openai', 'mistral'] as const;

export type TranslationProvider = (typeof SUPPORTED_TRANSLATION_PROVIDERS)[number];

export type TranslationSettings = {
  provider: TranslationProvider;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
};

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  provider: 'openai',
  apiBaseUrl: '',
  apiKey: '',
  model: ''
};
