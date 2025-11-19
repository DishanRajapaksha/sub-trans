import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

type RuntimeShim = {
  lastError?: { message?: string } | undefined;
  sendMessage: (message: unknown, callback: (response: unknown) => void) => void;
};

type ChromeShim = {
  runtime: RuntimeShim;
};

const buildContentScriptBundle = (): string => {
  const esbuildBin = require.resolve('esbuild/bin/esbuild');
  return execFileSync(
    esbuildBin,
    ['src/content/index.ts', '--bundle', '--format=esm', '--platform=browser', '--target=es2020'],
    { encoding: 'utf-8' }
  );
};

describe('headless chromium translated track injection', () => {
  let browser: Browser;
  let bundledContentScript: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    bundledContentScript = buildContentScriptBundle();
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

  it('injects an English track when translation is returned', async () => {
    const translatedVtt = ['WEBVTT', '', '00:00:00.000 --> 00:00:02.000', 'TRANSLATED'].join('\n');

    await withPage(async (page) => {
      const frenchTrackVtt = encodeURIComponent('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nSOUS-TITRE');
      await page.setContent(`
        <!doctype html>
        <html>
          <body>
            <video controls>
              <track kind="subtitles" srclang="fr" label="Français" src="data:text/vtt;charset=utf-8,${frenchTrackVtt}" default>
            </video>
          </body>
        </html>
      `);

      await page.evaluate((vttText) => {
        (window as typeof window & { chrome?: ChromeShim }).chrome = {
          runtime: {
            lastError: undefined,
            sendMessage: (_message: unknown, callback: (response: unknown) => void) => {
              window.setTimeout(() => {
                callback({ status: 'translated', translatedVtt: vttText });
              }, 0);
            }
          }
        } satisfies ChromeShim;
      }, translatedVtt);

      await page.addScriptTag({ type: 'module', content: bundledContentScript });

      await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('track')).some((track) => track.srclang === 'en');
      });

      const englishTrack = await page.evaluate(async () => {
        const tracks = Array.from(document.querySelectorAll('track')) as HTMLTrackElement[];
        const translatedTrack = tracks.find((track) => track.srclang === 'en');
        if (!translatedTrack) {
          return null;
        }

        const response = await fetch(translatedTrack.src);
        const translatedVttContent = await response.text();
        return {
          label: translatedTrack.label,
          srclang: translatedTrack.srclang,
          default: translatedTrack.default,
          src: translatedTrack.src,
          translatedVttContent
        };
      });

      expect(englishTrack).not.toBeNull();
      expect(englishTrack).toMatchObject({
        label: 'English (translated)',
        srclang: 'en',
        default: true
      });
      expect(englishTrack?.src).toMatch(/^blob:/);
      expect(englishTrack?.translatedVttContent).toContain('TRANSLATED');
    });
  }, 20_000);
});
