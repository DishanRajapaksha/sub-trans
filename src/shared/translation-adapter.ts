import { extensionBrowser } from './browser';
import {
  DEFAULT_TRANSLATION_SETTINGS,
  SUPPORTED_TRANSLATION_PROVIDERS,
  type TranslationProvider,
  type TranslationSettings
} from './translation-settings';

export type TranslationRequest = {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
};

type TranslationSegment = { index: number; text: string };

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MISTRAL_DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';
const CHAT_COMPLETIONS_PATH = '/chat/completions';

const PROVIDER_DEFAULT_MODELS: Record<TranslationProvider, string> = {
  openai: 'gpt-4o-mini-translate',
  mistral: 'mistral-large-latest'
};

const MAX_SEGMENTS_PER_BATCH = 20;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_OVERRIDE = 50;

const log = (message: string, details: Record<string, unknown> = {}): void => {
  console.log('[Arte Subtitle Translator][translation]', message, details);
};

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const sanitizeBatchSize = (value?: number): number => {
  if (!value || Number.isNaN(value)) {
    return MAX_SEGMENTS_PER_BATCH;
  }

  const clamped = Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_OVERRIDE, Math.floor(value)));
  return clamped;
};

const chunkSegments = (segments: TranslationSegment[], batchSize: number): TranslationSegment[][] => {
  const batches: TranslationSegment[][] = [];
  for (let index = 0; index < segments.length; index += batchSize) {
    batches.push(segments.slice(index, index + batchSize));
  }
  return batches;
};

const buildSystemPrompt = (sourceLanguage: string, targetLanguage: string): string => {
  return [
    'You are a subtitle translation engine.',
    `Translate every cue from ${sourceLanguage} to ${targetLanguage}.`,
    'Do not summarise, merge, or annotate the cues.',
    'Reply with JSON: {"translations":["string"]} matching the provided order.'
  ].join(' ');
};

const buildUserPayload = (segments: TranslationSegment[], request: TranslationRequest) => ({
  sourceLanguage: request.sourceLanguage,
  targetLanguage: request.targetLanguage,
  instruction: 'Translate each cue and keep the same order.',
  segments: segments.map((segment) => segment.text)
});

const getProviderBaseUrl = (provider: TranslationProvider, apiBaseUrl: string): string => {
  const provided = apiBaseUrl.trim();
  if (provided.length > 0) {
    return stripTrailingSlash(provided);
  }
  return provider === 'openai' ? OPENAI_DEFAULT_BASE_URL : MISTRAL_DEFAULT_BASE_URL;
};

const ensureProvider = (provider: string): TranslationProvider => {
  if (SUPPORTED_TRANSLATION_PROVIDERS.includes(provider as TranslationProvider)) {
    return provider as TranslationProvider;
  }
  throw new Error(`Unsupported translation provider: ${provider}`);
};

const ensureApiKey = (settings: TranslationSettings): void => {
  if (!settings.apiKey) {
    throw new Error('Translation provider API key is required.');
  }
};

const loadTranslationSettings = async (): Promise<TranslationSettings> => {
  const storageArea = extensionBrowser.storage.sync ?? extensionBrowser.storage.local;
  if (!storageArea) {
    throw new Error('Translation preferences storage is unavailable.');
  }

  return new Promise((resolve, reject) => {
    storageArea.get(DEFAULT_TRANSLATION_SETTINGS, (items) => {
      const error = extensionBrowser.runtime.lastError;
      if (error) {
        reject(new Error(error.message ?? 'Unable to read translation preferences.'));
        return;
      }

      resolve({ ...DEFAULT_TRANSLATION_SETTINGS, ...(items as Partial<TranslationSettings>) });
    });
  });
};

type ChatCompletionsPayload = {
  model: string;
  temperature: number;
  response_format: { type: 'json_object' };
  messages: Array<{ role: 'system' | 'user'; content: string }>;
};

const buildChatCompletionsPayload = (
  batch: TranslationSegment[],
  request: TranslationRequest,
  settings: TranslationSettings
): ChatCompletionsPayload => {
  const model = settings.model || PROVIDER_DEFAULT_MODELS[ensureProvider(settings.provider)];
  return {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(request.sourceLanguage, request.targetLanguage) },
      { role: 'user', content: JSON.stringify(buildUserPayload(batch, request)) }
    ]
  };
};

const normalizeMessageContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textPart = content.find((part) => typeof part?.text === 'string');
    if (textPart && typeof textPart.text === 'string') {
      return textPart.text;
    }
  }

  throw new Error('Translation provider returned an unsupported response payload.');
};

const parseTranslationsJson = (content: string, expectedLength: number): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error('Translation provider returned malformed JSON.');
  }

  const translations = (parsed as { translations?: unknown })?.translations;
  if (!Array.isArray(translations)) {
    throw new Error('Translation provider response is missing the translations array.');
  }

  const sanitized = translations.map((entry) => (typeof entry === 'string' ? entry : ''));
  if (sanitized.length !== expectedLength) {
    throw new Error(
      `Translation provider returned ${sanitized.length} results for ${expectedLength} requested segments.`
    );
  }

  return sanitized;
};

const translateBatch = async (
  provider: TranslationProvider,
  batch: TranslationSegment[],
  request: TranslationRequest,
  settings: TranslationSettings,
  fetchFn: typeof fetch
): Promise<string[]> => {
  const baseUrl = getProviderBaseUrl(provider, settings.apiBaseUrl);
  const payload = buildChatCompletionsPayload(batch, request, settings);
  const url = `${baseUrl}${CHAT_COMPLETIONS_PATH}`;
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(payload)
  });

  log('Translation provider response received.', {
    provider,
    status: response.status,
    batchSize: batch.length
  });

  if (!response.ok) {
    throw new Error(`Translation provider responded with status ${response.status}.`);
  }

  const json = await response.json();
  const messageContent = json?.choices?.[0]?.message?.content;
  if (!messageContent) {
    throw new Error('Translation provider returned an empty response.');
  }

  const normalized = normalizeMessageContent(messageContent);
  return parseTranslationsJson(normalized, batch.length);
};

const shouldSkipTranslation = (text: string): boolean => text.trim().length === 0;

export type TranslateTextsDependencies = {
  fetchFn?: typeof fetch;
  loadSettingsFn?: () => Promise<TranslationSettings>;
  maxBatchSize?: number;
};

export const translateTexts = async (
  request: TranslationRequest,
  deps: TranslateTextsDependencies = {}
): Promise<string[]> => {
  const fetchFn = deps.fetchFn ?? fetch;
  const loadSettingsFn = deps.loadSettingsFn ?? loadTranslationSettings;
  const batchSize = sanitizeBatchSize(deps.maxBatchSize);

  if (!Array.isArray(request.texts) || request.texts.length === 0) {
    return [];
  }

  const settings = await loadSettingsFn();
  const provider = ensureProvider(settings.provider);
  ensureApiKey(settings);

  const translationSlots = request.texts.map(() => '');
  const segments = request.texts.map<TranslationSegment>((text, index) => ({ index, text }));

  const translatableSegments = segments.filter((segment) => {
    if (shouldSkipTranslation(segment.text)) {
      translationSlots[segment.index] = '';
      return false;
    }
    return true;
  });

  if (translatableSegments.length === 0) {
    return translationSlots;
  }

  const batches = chunkSegments(translatableSegments, batchSize);
  log('Starting translation request.', {
    provider,
    totalSegments: translatableSegments.length,
    batchCount: batches.length
  });

  for (const batch of batches) {
    const batchTranslations = await translateBatch(provider, batch, request, settings, fetchFn);
    batch.forEach((segment, index) => {
      translationSlots[segment.index] = batchTranslations[index];
    });
  }

  log('Translation completed.', { provider, totalSegments: translatableSegments.length });
  return translationSlots;
};
