import { sendRuntimeMessage } from '../shared/browser';
import { TranslateVttMessage, TranslationResponse } from '../shared/messages';

const VIDEO_LOOKUP_TIMEOUT = 10_000;
const TRACK_LOOKUP_TIMEOUT = 10_000;

const log = (...args: unknown[]): void => {
  console.log('[Arte Subtitle Translator]', ...args);
};

const TRANSLATED_TRACK_LABEL = 'English (translated)';

const findExistingTranslatedTrack = (video: HTMLVideoElement): HTMLTrackElement | null => {
  const tracks = Array.from(video.querySelectorAll('track'));
  return (
    tracks.find((track) => {
      const srclang = track.srclang?.toLowerCase() ?? '';
      const label = track.label?.toLowerCase() ?? '';
      return srclang === 'en' && label === TRANSLATED_TRACK_LABEL.toLowerCase();
    }) ?? null
  );
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

export const requestTranslation = async (track: HTMLTrackElement): Promise<string | null> => {
  if (!track.src) {
    log('French track does not expose a src attribute.');
    return null;
  }

  const message: TranslateVttMessage = {
    type: 'TRANSLATE_VTT',
    url: track.src,
    sourceLanguage: 'fr',
    targetLanguage: 'en'
  };

  try {
    log('Sent translation request for', track.src);
    const response = await sendRuntimeMessage<TranslateVttMessage, TranslationResponse>(message);
    if (response?.status === 'translated') {
      log('Received translated subtitles for', track.src);
      return response.translatedVtt;
    }

    log('Translation request returned an error', response?.message ?? 'Unknown response');
    return null;
  } catch (error) {
    log('Failed to send translation request', error);
    return null;
  }
};

type InjectTranslatedTrackDependencies = {
  createObjectURLFn?: (blob: Blob) => string;
};

export const injectTranslatedTrack = (
  video: HTMLVideoElement,
  sourceTrack: HTMLTrackElement,
  translatedVtt: string,
  deps: InjectTranslatedTrackDependencies = {}
): HTMLTrackElement => {
  const createObjectURLFn = deps.createObjectURLFn ?? URL.createObjectURL.bind(URL);
  const translatedBlob = new Blob([translatedVtt], { type: 'text/vtt' });
  const translatedSrc = createObjectURLFn(translatedBlob);

  const existingTranslatedTrack = findExistingTranslatedTrack(video);
  const translatedTrack = (existingTranslatedTrack ?? sourceTrack.cloneNode(true)) as HTMLTrackElement;
  translatedTrack.src = translatedSrc;
  translatedTrack.srclang = 'en';
  translatedTrack.label = TRANSLATED_TRACK_LABEL;
  translatedTrack.default = true;
  if (!existingTranslatedTrack) {
    video.append(translatedTrack);
    log('Injected translated subtitle track.');
  } else {
    log('Updated translated subtitle track.');
  }
  return translatedTrack;
};

type BootstrapDependencies = {
  waitForVideoFn?: () => Promise<HTMLVideoElement | null>;
  waitForFrenchTrackFn?: (video: HTMLVideoElement) => Promise<HTMLTrackElement | null>;
  requestTranslationFn?: (track: HTMLTrackElement) => Promise<string | null>;
  injectTranslatedTrackFn?: (
    video: HTMLVideoElement,
    sourceTrack: HTMLTrackElement,
    translatedVtt: string
  ) => HTMLTrackElement;
};

export const bootstrap = async (deps: BootstrapDependencies = {}): Promise<void> => {
  const waitForVideoFn = deps.waitForVideoFn ?? waitForVideo;
  const waitForFrenchTrackFn = deps.waitForFrenchTrackFn ?? waitForFrenchTrack;
  const requestTranslationFn = deps.requestTranslationFn ?? requestTranslation;
  const injectTranslatedTrackFn = deps.injectTranslatedTrackFn ?? injectTranslatedTrack;

  const processedVideos = new WeakSet<HTMLVideoElement>();

  const processVideo = async (video: HTMLVideoElement): Promise<void> => {
    if (processedVideos.has(video)) {
      return;
    }
    processedVideos.add(video);

    log('Video element detected. Searching for subtitle tracks...');
    try {
      const frenchTrack = await waitForFrenchTrackFn(video);
      if (!frenchTrack) {
        log('No French subtitle track discovered.');
        return;
      }

      log('French subtitle track found.');
      const translatedVtt = await requestTranslationFn(frenchTrack);
      if (!translatedVtt) {
        log('Unable to translate French subtitle track.');
        return;
      }

      injectTranslatedTrackFn(video, frenchTrack, translatedVtt);
    } catch (error) {
      log('Unhandled translation request error', error);
    }
  };

  const processAvailableVideos = (): void => {
    const videos = Array.from(document.querySelectorAll('video'));
    videos.forEach((videoElement) => {
      if (!processedVideos.has(videoElement)) {
        void processVideo(videoElement);
      }
    });
  };

  const video = await waitForVideoFn();
  if (!video) {
    log('No <video> element detected on this page.');
    return;
  }

  await processVideo(video);

  processAvailableVideos();

  const observer = new MutationObserver(() => {
    processAvailableVideos();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
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
