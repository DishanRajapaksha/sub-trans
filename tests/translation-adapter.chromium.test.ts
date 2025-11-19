import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import type {
  TranslateTextsDependencies,
  TranslationRequest
} from '../src/shared/translation-adapter';
import {
  DEFAULT_TRANSLATION_SETTINGS,
  type TranslationSettings
} from '../src/shared/translation-settings';

type TranslationAdapterModule = typeof import('../src/shared/translation-adapter');

type ChromeWithStorage = typeof chrome & {
  storage: {
    sync?: chrome.storage.StorageArea;
    local?: chrome.storage.StorageArea;
  };
};

let storageValues: TranslationSettings = { ...DEFAULT_TRANSLATION_SETTINGS };
let storageGetErrorPayload: { message?: string } | null = null;

const createStorageArea = (): chrome.storage.StorageArea => {
  return {
    get: (_items: unknown, callback: (items: unknown) => void) => {
      const chromeGlobal = (globalThis as typeof globalThis & { chrome?: ChromeWithStorage }).chrome;
      if (storageGetErrorPayload) {
        if (chromeGlobal?.runtime) {
          chromeGlobal.runtime.lastError = storageGetErrorPayload as { message?: string };
        }
        callback({});
        storageGetErrorPayload = null;
        return;
      }
      if (chromeGlobal?.runtime) {
        chromeGlobal.runtime.lastError = undefined;
      }
      callback({ ...storageValues });
    },
    set: (items: unknown, callback?: () => void) => {
      storageValues = { ...storageValues, ...(items as Partial<TranslationSettings>) };
      const chromeGlobal = (globalThis as typeof globalThis & { chrome?: ChromeWithStorage }).chrome;
      if (chromeGlobal?.runtime) {
        chromeGlobal.runtime.lastError = undefined;
      }
      callback?.();
    }
  } as chrome.storage.StorageArea;
};

const installChromeStub = (): void => {
  const storageArea = createStorageArea();
  (globalThis as typeof globalThis & { chrome?: ChromeWithStorage }).chrome = {
    runtime: { lastError: undefined },
    storage: {
      sync: storageArea,
      local: storageArea
    }
  } as ChromeWithStorage;
};

const setStorageValues = (values: TranslationSettings): void => {
  storageValues = { ...values };
};

const setStorageGetError = (message?: string): void => {
  storageGetErrorPayload = message === undefined ? {} : { message };
};

const removeStorageArea = (key: 'sync' | 'local'): void => {
  const chromeGlobal = (globalThis as typeof globalThis & { chrome?: ChromeWithStorage }).chrome;
  if (chromeGlobal?.storage) {
    delete chromeGlobal.storage[key];
  }
};

const restoreStorageArea = (key: 'sync' | 'local'): void => {
  const chromeGlobal = (globalThis as typeof globalThis & { chrome?: ChromeWithStorage }).chrome;
  if (chromeGlobal) {
    chromeGlobal.storage[key] = createStorageArea();
  }
};

type FetchCall = {
  url: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  index: number;
};

const extractSegmentsFromPayload = (payload: Record<string, unknown>): string[] => {
  const userMessage = Array.isArray(payload?.messages)
    ? (payload.messages as Array<{ role: string; content: string }>).find((message) => message.role === 'user')
    : null;
  if (!userMessage || typeof userMessage.content !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(userMessage.content) as { segments?: unknown };
    return Array.isArray(parsed.segments) ? (parsed.segments as string[]) : [];
  } catch (error) {
    return [];
  }
};

const buildProviderResponse = (
  translations: string[],
  options: { content?: unknown; status?: number } = {}
): Response => {
  const messageContent = options.content ?? JSON.stringify({ translations });
  const body = { choices: [{ message: { content: messageContent } }] };
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

const createFetchStub = (
  responder: (call: FetchCall) => Response | Promise<Response>
): { fetchFn: typeof fetch; calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetchFn: typeof fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : 'url' in (input as Request)
            ? (input as Request).url
            : String(input);
    const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const headers: Record<string, string> = {};
    if (init?.headers && typeof init.headers === 'object') {
      Object.entries(init.headers as Record<string, string>).forEach(([key, value]) => {
        headers[key.toLowerCase()] = String(value);
      });
    }

    const call: FetchCall = { url, payload, headers, index };
    index += 1;
    calls.push(call);
    return responder(call);
  };
  return { fetchFn, calls };
};

describe('translation adapter (chromium)', () => {
  let browser: Browser;
  let translateTexts: TranslationAdapterModule['translateTexts'];

  beforeAll(async () => {
    installChromeStub();
    const module = await import('../src/shared/translation-adapter');
    translateTexts = module.translateTexts;
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(() => {
    storageValues = { ...DEFAULT_TRANSLATION_SETTINGS };
    storageGetErrorPayload = null;
    const chromeGlobal = (globalThis as typeof globalThis & { chrome?: ChromeWithStorage }).chrome;
    if (chromeGlobal?.storage) {
      if (!chromeGlobal.storage.sync) {
        chromeGlobal.storage.sync = createStorageArea();
      }
      if (!chromeGlobal.storage.local) {
        chromeGlobal.storage.local = createStorageArea();
      }
      chromeGlobal.runtime.lastError = undefined;
    }
  });

  afterAll(async () => {
    await browser?.close();
  });

  const withPage = async (run: (page: Page) => Promise<void>): Promise<void> => {
    const page = await browser.newPage();
    try {
      await run(page);
    } finally {
      await page.close();
    }
  };

  const runTranslationInChromium = async (
    page: Page,
    request: TranslationRequest,
    deps?: TranslateTextsDependencies
  ): Promise<string[]> => {
    const bindingName = `translate_${Math.random().toString(36).slice(2)}`;
    await page.exposeBinding(bindingName, (_source, payload: TranslationRequest) => translateTexts(payload, deps));
    return page.evaluate(
      ({ name, req }) =>
        (window as typeof window & { [key: string]: (message: TranslationRequest) => Promise<string[]> })[name](req),
      { name: bindingName, req: request }
    );
  };

  it('translates via OpenAI with chunking and preserves blank cues', async () => {
    const request: TranslationRequest = {
      texts: ['Bonjour', '', 'Salut', 'Au revoir'],
      sourceLanguage: 'fr',
      targetLanguage: 'en'
    };

    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'openai-key',
      apiBaseUrl: 'https://translations.example.com/api',
      model: 'gpt-custom'
    };

    const { fetchFn, calls } = createFetchStub((call) => {
      const segments = extractSegmentsFromPayload(call.payload);
      const translations = segments.map((text, segmentIndex) => `EN-${call.index}-${segmentIndex}-${text}`);
      return buildProviderResponse(translations);
    });

    await withPage(async (page) => {
      const result = await runTranslationInChromium(page, request, {
        fetchFn,
        loadSettingsFn: async () => config,
        maxBatchSize: 2
      });

      expect(result).toEqual([
        'EN-0-0-Bonjour',
        '',
        'EN-0-1-Salut',
        'EN-1-0-Au revoir'
      ]);
    });

    expect(calls).toHaveLength(2);
    calls.forEach((call) => {
      expect(call.url).toBe('https://translations.example.com/api/chat/completions');
      expect(call.payload.model).toBe('gpt-custom');
      expect(call.headers.authorization).toBe('Bearer openai-key');
    });
  });

  it('uses default Mistral endpoints and supports array-based provider content', async () => {
    const config: TranslationSettings = {
      provider: 'mistral',
      apiKey: 'mistral-key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn, calls } = createFetchStub((call) => {
      const segments = extractSegmentsFromPayload(call.payload);
      const translations = segments.map((text) => `M-${text.toUpperCase()}`);
      const content = [
        {
          type: 'output_text',
          text: JSON.stringify({ translations })
        }
      ];
      return buildProviderResponse([], { content });
    });

    await withPage(async (page) => {
      const result = await runTranslationInChromium(
        page,
        { texts: ['un', 'deux'], sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn, loadSettingsFn: async () => config, maxBatchSize: -5 }
      );

      expect(result).toEqual(['M-UN', 'M-DEUX']);
    });

    expect(calls).toHaveLength(2);
    calls.forEach((call) => {
      expect(call.url).toBe('https://api.mistral.ai/v1/chat/completions');
      expect(call.payload.model).toBe('mistral-large-latest');
    });
  });

  it('rejects when the provider returns a mismatched number of translations', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn } = createFetchStub((_call) => buildProviderResponse(['only-one']));

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['a', 'b'], sourceLanguage: 'fr', targetLanguage: 'en' }, {
          fetchFn,
          loadSettingsFn: async () => config
        })
      ).rejects.toThrow(/returned 1 results for 2 requested segments/);
    });
  });

  it('validates provider configuration and API keys', async () => {
    const invalidConfig = {
      provider: 'openai',
      apiKey: '',
      apiBaseUrl: '',
      model: ''
    } as TranslationSettings;

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['hello'], sourceLanguage: 'fr', targetLanguage: 'en' }, {
          loadSettingsFn: async () => invalidConfig
        })
      ).rejects.toThrow(/API key is required/);
    });

    const unsupportedProvider = {
      ...DEFAULT_TRANSLATION_SETTINGS,
      provider: 'mock-provider'
    } as unknown as TranslationSettings;

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['a'], sourceLanguage: 'fr', targetLanguage: 'en' }, {
          loadSettingsFn: async () => unsupportedProvider
        })
      ).rejects.toThrow(/Unsupported translation provider/);
    });
  });

  it('skips network calls for purely empty cues', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn, calls } = createFetchStub((_call) => buildProviderResponse([]));

    await withPage(async (page) => {
      const result = await runTranslationInChromium(
        page,
        { texts: [' ', '\n'], sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn, loadSettingsFn: async () => config }
      );

      expect(result).toEqual(['', '']);
    });

    expect(calls).toHaveLength(0);
  });

  it('returns an empty array when the request has no texts', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn, calls } = createFetchStub((_call) => buildProviderResponse([]));

    await withPage(async (page) => {
      const result = await runTranslationInChromium(
        page,
        { texts: [], sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn, loadSettingsFn: async () => config }
      );

      expect(result).toEqual([]);
    });

    expect(calls).toHaveLength(0);
  });

  it('treats invalid request payloads as empty input', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn, calls } = createFetchStub((_call) => buildProviderResponse([]));

    await withPage(async (page) => {
      const result = await runTranslationInChromium(
        page,
        { texts: null as unknown as string[], sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn, loadSettingsFn: async () => config }
      );

      expect(result).toEqual([]);
    });

    expect(calls).toHaveLength(0);
  });

  it('reads configuration from storage and falls back to local storage', async () => {
    setStorageValues({ provider: 'openai', apiKey: 'stored-key', apiBaseUrl: 'https://stored', model: 'gpt' });

    const { fetchFn: firstFetch, calls: firstCalls } = createFetchStub((call) => {
      const translations = extractSegmentsFromPayload(call.payload).map((text) => `S-${text}`);
      return buildProviderResponse(translations);
    });

    await withPage(async (page) => {
      const result = await runTranslationInChromium(
        page,
        { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn: firstFetch }
      );
      expect(result).toEqual(['S-bonjour']);
    });

    expect(firstCalls[0]?.url).toBe('https://stored/chat/completions');

    removeStorageArea('sync');
    const { fetchFn: secondFetch } = createFetchStub((call) => {
      const translations = extractSegmentsFromPayload(call.payload).map((text) => `L-${text}`);
      return buildProviderResponse(translations);
    });

    await withPage(async (page) => {
      const result = await runTranslationInChromium(
        page,
        { texts: ['salut'], sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn: secondFetch }
      );
      expect(result).toEqual(['L-salut']);
    });

    restoreStorageArea('sync');
  });

  it('fails when storage returns an error', async () => {
    const { fetchFn } = createFetchStub((_call) => buildProviderResponse([]));
    setStorageGetError('storage-failure');

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' }, { fetchFn })
      ).rejects.toThrow(/storage-failure/);
    });
  });

  it('uses a default error message when storage does not provide one', async () => {
    const { fetchFn } = createFetchStub((_call) => buildProviderResponse([]));
    setStorageGetError();

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' }, { fetchFn })
      ).rejects.toThrow(/Unable to read translation preferences/);
    });
  });

  it('reports storage errors when no storage area is available', async () => {
    removeStorageArea('sync');
    removeStorageArea('local');

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' })
      ).rejects.toThrow(/storage is unavailable/);
    });

    restoreStorageArea('sync');
    restoreStorageArea('local');
  });

  it('surfaces HTTP failures from the provider', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn } = createFetchStub((_call) => buildProviderResponse([], { status: 429 }));

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' }, {
          fetchFn,
          loadSettingsFn: async () => config
        })
      ).rejects.toThrow(/responded with status 429/);
    });
  });

  it('fails when the provider payload cannot be parsed as JSON', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn } = createFetchStub((_call) => buildProviderResponse([], { content: '{' }));

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' }, {
          fetchFn,
          loadSettingsFn: async () => config
        })
      ).rejects.toThrow(/malformed JSON/);
    });
  });

  it('throws when the provider content array lacks text nodes', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const content = [{ type: 'output_text', value: 'no-text-field' }];
    const { fetchFn } = createFetchStub((_call) => buildProviderResponse([], { content }));

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' }, {
          fetchFn,
          loadSettingsFn: async () => config
        })
      ).rejects.toThrow(/unsupported response payload/);
    });
  });

  it('throws when the provider response omits the translations array', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn } = createFetchStub((_call) => buildProviderResponse([], { content: JSON.stringify({ nope: [] }) }));

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' }, {
          fetchFn,
          loadSettingsFn: async () => config
        })
      ).rejects.toThrow(/missing the translations array/);
    });
  });

  it('throws when the provider response lacks message content', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn } = createFetchStub(() =>
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' }, {
          fetchFn,
          loadSettingsFn: async () => config
        })
      ).rejects.toThrow(/empty response/);
    });
  });

  it('throws when the provider response uses unsupported content types', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const { fetchFn } = createFetchStub((_call) => buildProviderResponse([], { content: 42 as unknown }));

    await withPage(async (page) => {
      await expect(
        runTranslationInChromium(page, { texts: ['bonjour'], sourceLanguage: 'fr', targetLanguage: 'en' }, {
          fetchFn,
          loadSettingsFn: async () => config
        })
      ).rejects.toThrow(/unsupported response payload/);
    });
  });

  it('normalizes non-string translations into empty strings', async () => {
    const config: TranslationSettings = {
      provider: 'openai',
      apiKey: 'key',
      apiBaseUrl: '',
      model: ''
    };

    const translations = JSON.stringify({ translations: ['OK', 123] });
    const { fetchFn } = createFetchStub((_call) => buildProviderResponse([], { content: translations }));

    await withPage(async (page) => {
      const result = await runTranslationInChromium(
        page,
        { texts: ['one', 'two'], sourceLanguage: 'fr', targetLanguage: 'en' },
        { fetchFn, loadSettingsFn: async () => config }
      );
      expect(result).toEqual(['OK', '']);
    });
  });
});
