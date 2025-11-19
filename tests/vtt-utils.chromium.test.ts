import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, chromium, Page } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseVtt, rebuildVtt } from '../src/shared/vtt';

const execFileAsync = promisify(execFile);

const arteVideoPageUrl =
  'https://www.arte.tv/fr/videos/117798-000-A/tous-accros-le-piege-des-aliments-ultratransformes/';
const arteSubtitleUrl =
  'https://arte-cmafhls.akamaized.net/am/cmaf/117000/117700/117798-000-A/2025041410B51FCA52FE154899808A47149B6438F3/medias/117798-000-A_st_VF-MAL.vtt?CMCD=br%3D4816%2Ccid%3D%22-158067677%22%2Cdl%3D0%2Cmtp%3D69900%2Cnor%3D%22undefined%22%2Cot%3Dc%2Csf%3Dh%2Csid%3D%222b8942f7-9156-4d2d-bf47-510cfafd6d04%22%2Cst%3Dv%2Ctb%3D4816';

let cachedSubtitleText: Promise<string> | null = null;
const downloadSubtitleText = (): Promise<string> => {
  if (!cachedSubtitleText) {
    cachedSubtitleText = execFileAsync('curl', ['-sL', arteSubtitleUrl]).then(({ stdout }) => stdout);
  }
  return cachedSubtitleText;
};

let cachedVideoHtml: Promise<string> | null = null;
const downloadVideoHtml = (): Promise<string> => {
  if (!cachedVideoHtml) {
    cachedVideoHtml = execFileAsync('curl', ['-sL', arteVideoPageUrl]).then(({ stdout }) => stdout);
  }
  return cachedVideoHtml;
};

describe('VTT utilities with the official Arte subtitle file', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 30_000);

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

  it(
    'parses and rebuilds cues from the Arte.tv subtitle source',
    async () => {
      const subtitleText = await downloadSubtitleText();
      await withPage(async (page) => {
        await page.route(arteSubtitleUrl, (route) => {
          route.fulfill({ body: subtitleText, contentType: 'text/vtt; charset=utf-8' });
        });
        await page.goto('about:blank');
        const { vttContent, cueCount } = await page.evaluate(async (subtitleUrl) => {
          const response = await fetch(subtitleUrl);
          const text = await response.text();
          const cuesDiscovered = (text.match(/-->/g) ?? []).length;
          return { vttContent: text, cueCount: cuesDiscovered };
        }, arteSubtitleUrl);

        expect(cueCount).toBeGreaterThan(0);

        const parsedCues = parseVtt(vttContent);
        expect(parsedCues.length).toBeGreaterThan(0);
        expect(parsedCues[0]?.start).toMatch(/\d{2}:\d{2}:\d{2}/);

        const rebuilt = rebuildVtt(parsedCues);
        const reparsed = parseVtt(rebuilt);
        expect(reparsed).toEqual(parsedCues);
      });
    },
    60_000
  );

  it(
    'confirms the Arte.tv video page responds successfully',
    async () => {
      const htmlContent = await downloadVideoHtml();
      await withPage(async (page) => {
        await page.route(arteVideoPageUrl, (route) => {
          route.fulfill({ body: htmlContent, contentType: 'text/html; charset=utf-8' });
        });
        const response = await page.goto(arteVideoPageUrl, { waitUntil: 'domcontentloaded' });
        expect(response?.ok()).toBe(true);
        const snippet = (await page.content()).slice(0, 200).toLowerCase();
        expect(snippet).toContain('<html');
      });
    },
    60_000
  );
});
