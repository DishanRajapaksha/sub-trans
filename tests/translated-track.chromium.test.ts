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

  it('does not inject a translated track when the background returns an error', async () => {
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

      await page.evaluate(() => {
        (window as typeof window & { chrome?: ChromeShim }).chrome = {
          runtime: {
            lastError: undefined,
            sendMessage: (_message: unknown, callback: (response: unknown) => void) => {
              window.setTimeout(() => {
                callback({ status: 'error', message: 'translation unavailable' });
              }, 0);
            }
          }
        } satisfies ChromeShim;
      });

      await page.addScriptTag({ type: 'module', content: bundledContentScript });

      await page.waitForTimeout(200);

      const englishTrackCount = await page.evaluate(() => {
        return document.querySelectorAll('track[srclang="en"]').length;
      });

      expect(englishTrackCount).toBe(0);
    });
  }, 20_000);

  it('reuses an existing translated track without duplicating it', async () => {
    const translatedVtt = ['WEBVTT', '', '00:00:05.000 --> 00:00:06.000', 'UPDATED-TRANSLATION'].join('\n');

    await withPage(async (page) => {
      const frenchTrackVtt = encodeURIComponent('WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nSOUS-TITRE');
      const placeholderVtt = encodeURIComponent('WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nPLACEHOLDER');
      await page.setContent(`
        <!doctype html>
        <html>
          <body>
            <video controls>
              <track kind="subtitles" srclang="fr" label="Français" src="data:text/vtt;charset=utf-8,${frenchTrackVtt}" default>
              <track id="pre-existing-english" kind="subtitles" srclang="en" label="English (translated)" src="data:text/vtt;charset=utf-8,${placeholderVtt}">
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
        const englishTracks = Array.from(document.querySelectorAll('track[srclang="en"]')) as HTMLTrackElement[];
        if (englishTracks.length !== 1) {
          return false;
        }

        return englishTracks[0].src.startsWith('blob:');
      });

      const englishTrack = await page.evaluate(async () => {
        const track = document.querySelector('track[srclang="en"]') as HTMLTrackElement | null;
        if (!track) {
          return null;
        }

        const response = await fetch(track.src);
        const translatedVttContent = await response.text();
        return { id: track.id, translatedVttContent };
      });

      expect(englishTrack).toEqual({
        id: 'pre-existing-english',
        translatedVttContent: translatedVtt
      });
    });
  }, 20_000);

  it('skips translation when the detected French track has no src attribute', async () => {
    await withPage(async (page) => {
      await page.setContent(`
        <!doctype html>
        <html>
          <body>
            <video controls>
              <track id="missing-src" kind="subtitles" srclang="fr" label="Français" default>
            </video>
          </body>
        </html>
      `);

      await page.evaluate(() => {
        (window as typeof window & { chrome?: ChromeShim & { translationRequests?: number } }).chrome = {
          translationRequests: 0,
          runtime: {
            lastError: undefined,
            sendMessage: (_message: unknown, callback: (response: unknown) => void) => {
              (window as typeof window & { chrome?: ChromeShim & { translationRequests?: number } }).chrome!.translationRequests! += 1;
              window.setTimeout(() => {
                callback({ status: 'translated', translatedVtt: 'WEBVTT' });
              }, 0);
            }
          }
        } satisfies ChromeShim & { translationRequests?: number };
      });

      await page.addScriptTag({ type: 'module', content: bundledContentScript });

      await page.waitForTimeout(200);

      const { englishTrackCount, translationRequests } = await page.evaluate(() => {
        const chromeShim = (window as typeof window & { chrome?: ChromeShim & { translationRequests?: number } }).chrome;
        return {
          englishTrackCount: document.querySelectorAll('track[srclang="en"]').length,
          translationRequests: chromeShim?.translationRequests ?? 0
        };
      });

      expect(englishTrackCount).toBe(0);
      expect(translationRequests).toBe(0);
    });
  }, 20_000);

  it('injects translations for videos that are added after bootstrap', async () => {
    const firstTranslation = ['WEBVTT', '', '00:00:01.000 --> 00:00:02.000', 'TRANSLATED-ONE'].join('\n');
    const secondTranslation = ['WEBVTT', '', '00:00:03.000 --> 00:00:04.000', 'TRANSLATED-TWO'].join('\n');

    await withPage(async (page) => {
      const frenchTrackVtt = encodeURIComponent('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSOUS-TITRE-1');
      const laterTrackVtt = encodeURIComponent('WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nSOUS-TITRE-2');
      await page.setContent(`
        <!doctype html>
        <html>
          <body>
            <video id="initial-video" controls>
              <track kind="subtitles" srclang="fr" label="Français" src="data:text/vtt;charset=utf-8,${frenchTrackVtt}" default>
            </video>
          </body>
        </html>
      `);

      await page.evaluate((translations) => {
        let callCount = 0;
        (window as typeof window & { chrome?: ChromeShim }).chrome = {
          runtime: {
            lastError: undefined,
            sendMessage: (_message: unknown, callback: (response: unknown) => void) => {
              const index = Math.min(callCount, translations.length - 1);
              const translatedVtt = translations[index];
              callCount += 1;
              window.setTimeout(() => {
                callback({ status: 'translated', translatedVtt });
              }, 0);
            }
          }
        } satisfies ChromeShim;
      }, [firstTranslation, secondTranslation]);

      await page.addScriptTag({ type: 'module', content: bundledContentScript });

      await page.waitForFunction(() => {
        const initialVideo = document.getElementById('initial-video') as HTMLVideoElement | null;
        if (!initialVideo) {
          return false;
        }
        return initialVideo.querySelectorAll('track[srclang="en"]').length === 1;
      });

      await page.evaluate((laterVtt) => {
        window.setTimeout(() => {
          const video = document.createElement('video');
          video.id = 'secondary-video';
          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.srclang = 'fr';
          track.label = 'Français';
          track.src = `data:text/vtt;charset=utf-8,${laterVtt}`;
          video.append(track);
          document.body.append(video);
        }, 50);
      }, laterTrackVtt);

      await page.waitForFunction(
        () => {
          const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
          if (videos.length < 2) {
            return false;
          }
          return videos.every((video) => video.querySelectorAll('track[srclang="en"]').length === 1);
        },
        undefined,
        { timeout: 20_000 }
      );

      const englishTrackContents = await page.evaluate(async () => {
        const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
        const contents: string[] = [];
        for (const video of videos) {
          const track = video.querySelector('track[srclang="en"]') as HTMLTrackElement | null;
          if (track) {
            const response = await fetch(track.src);
            contents.push(await response.text());
          }
        }
        return contents;
      });

      expect(englishTrackContents).toHaveLength(2);
      expect(englishTrackContents[0]).toContain('TRANSLATED-ONE');
      expect(englishTrackContents[1]).toContain('TRANSLATED-TWO');
    });
  }, 30_000);

  it('keeps watching for new videos even after a translation failure', async () => {
    const successfulTranslation = ['WEBVTT', '', '00:00:07.000 --> 00:00:08.000', 'RECOVERED-TRANSLATION'].join('\n');

    await withPage(async (page) => {
      const firstTrackVtt = encodeURIComponent('WEBVTT\n\n00:00:07.000 --> 00:00:08.000\nSOUS-TITRE-ERROR');
      const secondTrackVtt = encodeURIComponent('WEBVTT\n\n00:00:09.000 --> 00:00:10.000\nSOUS-TITRE-SUCCESS');
      await page.setContent(`
        <!doctype html>
        <html>
          <body>
            <video id="first-video" controls>
              <track kind="subtitles" srclang="fr" label="Français" src="data:text/vtt;charset=utf-8,${firstTrackVtt}" default>
            </video>
          </body>
        </html>
      `);

      await page.evaluate((translation) => {
        let callCount = 0;
        (window as typeof window & { chrome?: ChromeShim }).chrome = {
          runtime: {
            lastError: undefined,
            sendMessage: (_message: unknown, callback: (response: unknown) => void) => {
              if (callCount === 0) {
                callCount += 1;
                window.setTimeout(() => {
                  (window as typeof window & { chrome?: ChromeShim }).chrome!.runtime.lastError = { message: 'Network failure' };
                  callback(undefined);
                  window.setTimeout(() => {
                    (window as typeof window & { chrome?: ChromeShim }).chrome!.runtime.lastError = undefined;
                  }, 0);
                }, 0);
                return;
              }

              callCount += 1;
              window.setTimeout(() => {
                callback({ status: 'translated', translatedVtt: translation });
              }, 0);
            }
          }
        } satisfies ChromeShim;
      }, successfulTranslation);

      await page.addScriptTag({ type: 'module', content: bundledContentScript });

      await page.waitForTimeout(300);

      await page.evaluate((laterVtt) => {
        const insertLaterVideo = () => {
          const video = document.createElement('video');
          video.id = 'second-video';
          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.srclang = 'fr';
          track.label = 'Français';
          track.src = `data:text/vtt;charset=utf-8,${laterVtt}`;
          video.append(track);
          document.body.append(video);
        };

        window.setTimeout(insertLaterVideo, 50);
      }, secondTrackVtt);

      await page.waitForFunction(() => {
        const secondVideo = document.getElementById('second-video') as HTMLVideoElement | null;
        if (!secondVideo) {
          return false;
        }
        const translatedTrack = secondVideo.querySelector('track[srclang="en"]');
        return Boolean(translatedTrack);
      });

      const { firstVideoEnglishTracks, secondVideoVtt } = await page.evaluate(async () => {
        const firstVideo = document.getElementById('first-video') as HTMLVideoElement | null;
        const secondVideo = document.getElementById('second-video') as HTMLVideoElement | null;
        const firstVideoEnglishTracks = firstVideo ? firstVideo.querySelectorAll('track[srclang="en"]').length : 0;
        let secondVideoVtt = '';
        if (secondVideo) {
          const track = secondVideo.querySelector('track[srclang="en"]') as HTMLTrackElement | null;
          if (track) {
            const response = await fetch(track.src);
            secondVideoVtt = await response.text();
          }
        }
        return { firstVideoEnglishTracks, secondVideoVtt };
      });

      expect(firstVideoEnglishTracks).toBe(0);
      expect(secondVideoVtt).toContain('RECOVERED-TRANSLATION');
    });
  }, 30_000);
});
