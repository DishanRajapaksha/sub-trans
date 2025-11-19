import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

type StorageArea = {
    get: (keys: unknown, callback: (items: unknown) => void) => void;
    set: (items: unknown, callback?: () => void) => void;
};

type ChromeShim = {
    runtime: { lastError?: { message?: string } };
    storage: {
        sync: StorageArea;
        local: StorageArea;
    };
};

const buildOptionsScriptBundle = (): string => {
    const esbuildBin = require.resolve('esbuild/bin/esbuild');
    return execFileSync(
        esbuildBin,
        ['src/options/index.ts', '--bundle', '--format=esm', '--platform=browser', '--target=es2020'],
        { encoding: 'utf-8' }
    );
};

describe('options page', () => {
    let browser: Browser;
    let bundledOptionsScript: string;
    let optionsHtml: string;

    beforeAll(async () => {
        browser = await chromium.launch({ headless: true });
        bundledOptionsScript = buildOptionsScriptBundle();
        optionsHtml = fs.readFileSync(path.resolve('public/options.html'), 'utf-8');
        // Remove the script tag to avoid 404s or interference
        optionsHtml = optionsHtml.replace('<script type="module" src="options.js"></script>', '');
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
    });

    const withPage = async (run: (page: Page) => Promise<void>): Promise<void> => {
        const page = await browser.newPage();
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => {
            pageErrors.push(error);
        });
        try {
            await run(page);
            if (pageErrors.length > 0) {
                throw pageErrors[0];
            }
        } finally {
            await page.close();
        }
    };

    it('loads settings from storage on init', async () => {
        await withPage(async (page) => {
            const storedSettings = {
                provider: 'mistral',
                apiKey: 'secret-key',
                apiBaseUrl: 'https://api.mistral.ai',
                model: 'mistral-tiny'
            };

            await page.setContent(optionsHtml);

            await page.evaluate((settings) => {
                (window as any).chrome = {
                    runtime: { lastError: undefined },
                    storage: {
                        sync: {
                            get: (_keys: any, callback: any) => callback(settings),
                            set: (_items: any, callback: any) => callback && callback()
                        },
                        local: {
                            get: (_keys: any, callback: any) => callback({}),
                            set: (_items: any, callback: any) => callback && callback()
                        }
                    }
                } satisfies ChromeShim;
            }, storedSettings);

            await page.addScriptTag({ type: 'module', content: bundledOptionsScript });

            await page.waitForFunction(() => {
                const provider = document.querySelector<HTMLSelectElement>('[name="provider"]');
                return provider?.value === 'mistral';
            });

            const values = await page.evaluate(() => {
                const getVal = (name: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)?.value;
                return {
                    provider: getVal('provider'),
                    apiKey: getVal('apiKey'),
                    apiBaseUrl: getVal('apiBaseUrl'),
                    model: getVal('model')
                };
            });

            expect(values).toEqual(storedSettings);
        });
    });

    it('saves settings to storage on submit', async () => {
        await withPage(async (page) => {
            await page.setContent(optionsHtml);

            // Mock storage to capture set calls
            await page.evaluate(() => {
                (window as any).storageData = {};
                (window as any).chrome = {
                    runtime: { lastError: undefined },
                    storage: {
                        sync: {
                            get: (_keys: any, callback: any) => callback({}),
                            set: (items: any, callback: any) => {
                                (window as any).storageData = items;
                                if (callback) callback();
                            }
                        },
                        local: {
                            get: (_keys: any, callback: any) => callback({}),
                            set: (_items: any, callback: any) => callback && callback()
                        }
                    }
                } satisfies ChromeShim;
            });

            await page.addScriptTag({ type: 'module', content: bundledOptionsScript });

            // Fill the form
            await page.selectOption('[name="provider"]', 'openai');
            await page.fill('[name="apiKey"]', 'sk-test-key');
            await page.fill('[name="model"]', 'gpt-4');
            await page.fill('[name="apiBaseUrl"]', 'https://api.openai.com');

            // Submit
            await page.click('button[type="submit"]');

            // Wait for status message
            await page.waitForSelector('[data-status][data-state="success"]');

            // Verify storage
            const storageData = await page.evaluate(() => (window as any).storageData);
            expect(storageData).toEqual({
                provider: 'openai',
                apiKey: 'sk-test-key',
                model: 'gpt-4',
                apiBaseUrl: 'https://api.openai.com'
            });
        });
    });

    it('shows error if provider is missing (validation)', async () => {
        await withPage(async (page) => {
            await page.setContent(optionsHtml);

            await page.evaluate(() => {
                (window as any).chrome = {
                    runtime: { lastError: undefined },
                    storage: {
                        sync: {
                            get: (_keys: any, callback: any) => callback({}),
                            set: (_items: any, callback: any) => callback && callback()
                        },
                        local: {
                            get: (_keys: any, callback: any) => callback({}),
                            set: (_items: any, callback: any) => callback && callback()
                        }
                    }
                } satisfies ChromeShim;
            });

            await page.addScriptTag({ type: 'module', content: bundledOptionsScript });

            // Clear provider (it might have a default, but let's try to set it to empty if possible or just submit empty form if it starts empty)
            // The default HTML has OpenAI selected.
            // Let's try to set it to an invalid value or empty string if possible.
            // The select has 'required' attribute. Browser validation might stop it.
            // But our JS validation `isSupportedProvider` also checks.

            // Let's try to bypass browser validation or just check if our JS handles it.
            // Actually, `readFormValues` checks `isSupportedProvider`.

            // We can try to set the value to something invalid via JS
            await page.evaluate(() => {
                const select = document.querySelector('[name="provider"]') as HTMLSelectElement;
                const option = document.createElement('option');
                option.value = 'invalid';
                option.text = 'Invalid';
                select.add(option);
                select.value = 'invalid';
            });

            await page.click('button[type="submit"]');

            await page.waitForSelector('[data-status][data-state="error"]');

            const statusText = await page.textContent('[data-status]');
            expect(statusText).toContain('Provider is required');
        });
    });
});
