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

const waitForVideo = (): Promise<HTMLVideoElement | null> => {
  const existing = document.querySelector('video');
  if (existing instanceof HTMLVideoElement) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const video = document.querySelector('video');
      if (video instanceof HTMLVideoElement) {
        observer.disconnect();
        resolve(video);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, VIDEO_LOOKUP_TIMEOUT);
  });
};

const isFrenchTrack = (track: HTMLTrackElement): boolean => {
  const label = track.label?.toLowerCase() ?? '';
  const srclang = track.srclang?.toLowerCase() ?? '';
  return (
    track.kind === 'subtitles' ||
    track.kind === 'captions'
  ) && (srclang === 'fr' || label.includes('fr'));
};

const waitForFrenchTrack = (video: HTMLVideoElement): Promise<HTMLTrackElement | null> => {
  const currentTrack = Array.from(video.querySelectorAll('track')).find(isFrenchTrack);
  if (currentTrack) {
    return Promise.resolve(currentTrack);
  }

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const tracks = Array.from(video.querySelectorAll('track'));
      const track = tracks.find(isFrenchTrack);
      if (track) {
        observer.disconnect();
        resolve(track);
      }
    });

    observer.observe(video, {
      childList: true,
      subtree: true
    });

    window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, TRACK_LOOKUP_TIMEOUT);
  });
};

const requestTranslation = async (track: HTMLTrackElement): Promise<void> => {
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

const bootstrap = async (): Promise<void> => {
  const video = await waitForVideo();
  if (!video) {
    log('No <video> element detected on this page.');
    return;
  }

  log('Video element detected. Searching for subtitle tracks...');
  const frenchTrack = await waitForFrenchTrack(video);
  if (!frenchTrack) {
    log('No French subtitle track discovered.');
    return;
  }

  log('French subtitle track found.');
  requestTranslation(frenchTrack).catch((error) => {
    log('Unhandled translation request error', error);
  });
};

void bootstrap();
