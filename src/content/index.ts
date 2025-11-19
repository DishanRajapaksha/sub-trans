import { sendRuntimeMessage } from '../shared/browser';

type TranslateVttMessage = {
  type: 'TRANSLATE_VTT';
  url: string;
  sourceLanguage: string;
  targetLanguage: string;
};

const VIDEO_LOOKUP_TIMEOUT = 10_000;
const TRACK_LOOKUP_TIMEOUT = 10_000;

const log = (...args: unknown[]): void => {
  console.log('[Arte Subtitle Translator]', ...args);
};

export const waitForVideo = (): Promise<HTMLVideoElement | null> => {
  const existing = document.querySelector('video');
  if (existing instanceof HTMLVideoElement) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    let observer: MutationObserver | null = null;

    const handleTimeout = () => {
      observer?.disconnect();
      resolve(null);
    };

    const handleVideo = (video: HTMLVideoElement) => {
      observer?.disconnect();
      window.clearTimeout(timeoutId);
      resolve(video);
    };

    observer = new MutationObserver(() => {
      const video = document.querySelector('video');
      if (video instanceof HTMLVideoElement) {
        handleVideo(video);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    const timeoutId = window.setTimeout(handleTimeout, VIDEO_LOOKUP_TIMEOUT);
  });
};

export const isFrenchTrack = (track: HTMLTrackElement): boolean => {
  const label = track.label?.toLowerCase() ?? '';
  const srclang = track.srclang?.toLowerCase() ?? '';
  const isSubtitleKind = track.kind === 'subtitles' || track.kind === 'captions';
  if (!isSubtitleKind) {
    return false;
  }

  const srclangLooksFrench = srclang.startsWith('fr');
  const labelLooksFrench = label.includes('fr') || label.includes('vf');
  return srclangLooksFrench || labelLooksFrench;
};

export const waitForFrenchTrack = (video: HTMLVideoElement): Promise<HTMLTrackElement | null> => {
  const currentTrack = Array.from(video.querySelectorAll('track')).find(isFrenchTrack);
  if (currentTrack) {
    return Promise.resolve(currentTrack);
  }

  return new Promise((resolve) => {
    let observer: MutationObserver | null = null;

    const handleTimeout = () => {
      observer?.disconnect();
      resolve(null);
    };

    const handleTrack = (track: HTMLTrackElement) => {
      observer?.disconnect();
      window.clearTimeout(timeoutId);
      resolve(track);
    };

    observer = new MutationObserver(() => {
      const tracks = Array.from(video.querySelectorAll('track'));
      const track = tracks.find(isFrenchTrack);
      if (track) {
        handleTrack(track);
      }
    });

    observer.observe(video, {
      childList: true,
      subtree: true
    });

    const timeoutId = window.setTimeout(handleTimeout, TRACK_LOOKUP_TIMEOUT);
  });
};

export const requestTranslation = async (track: HTMLTrackElement): Promise<void> => {
  if (!track.src) {
    log('French track does not expose a src attribute.');
    return;
  }

  const message: TranslateVttMessage = {
    type: 'TRANSLATE_VTT',
    url: track.src,
    sourceLanguage: 'fr',
    targetLanguage: 'en'
  };

  try {
    await sendRuntimeMessage<TranslateVttMessage, unknown>(message);
    log('Sent translation request for', track.src);
  } catch (error) {
    log('Failed to send translation request', error);
  }
};

type BootstrapDependencies = {
  waitForVideoFn?: () => Promise<HTMLVideoElement | null>;
  waitForFrenchTrackFn?: (video: HTMLVideoElement) => Promise<HTMLTrackElement | null>;
  requestTranslationFn?: (track: HTMLTrackElement) => Promise<void>;
};

export const bootstrap = async (deps: BootstrapDependencies = {}): Promise<void> => {
  const waitForVideoFn = deps.waitForVideoFn ?? waitForVideo;
  const waitForFrenchTrackFn = deps.waitForFrenchTrackFn ?? waitForFrenchTrack;
  const requestTranslationFn = deps.requestTranslationFn ?? requestTranslation;

  const video = await waitForVideoFn();
  if (!video) {
    log('No <video> element detected on this page.');
    return;
  }

  log('Video element detected. Searching for subtitle tracks...');
  const frenchTrack = await waitForFrenchTrackFn(video);
  if (!frenchTrack) {
    log('No French subtitle track discovered.');
    return;
  }

  log('French subtitle track found.');
  requestTranslationFn(frenchTrack).catch((error) => {
    log('Unhandled translation request error', error);
  });
};

type VitestImportMeta = ImportMeta & { vitest?: boolean };

export const shouldAutoBootstrap = (): boolean => {
  const meta = import.meta as VitestImportMeta;
  return !meta?.vitest;
};

type MaybeBootstrapDependencies = {
  bootstrapFn?: () => Promise<void>;
  shouldAutoBootstrapFn?: () => boolean;
};

export const maybeBootstrap = (deps: MaybeBootstrapDependencies = {}): void => {
  const shouldBootstrapFn = deps.shouldAutoBootstrapFn ?? shouldAutoBootstrap;
  const bootstrapFn = deps.bootstrapFn ?? bootstrap;

  if (shouldBootstrapFn()) {
    void bootstrapFn();
  }
};

maybeBootstrap();
