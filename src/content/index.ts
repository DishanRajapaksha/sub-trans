import { sendRuntimeMessage } from '../shared/browser';
import { TranslateVttMessage, TranslationResponse } from '../shared/messages';

const log = (...args: unknown[]): void => {
  console.log('[Arte Subtitle Translator]', ...args);
};

// DOM-based subtitle replacement
// We map original French text to Translated English text
const translationMap = new Map<string, string>();

// Listen for pre-translated VTTs from background script
const processElementTree = (root: ParentNode | null): void => {
  if (!root) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    handleTextNode(node as Text);
  }
};

const applyTranslationsToDocument = (): void => {
  processElementTree(document.body);
};

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'VTT_TRANSLATED') {
    log('Received translated VTT with mapping');

    if (message.mapping) {
      const mapping = message.mapping as Record<string, string>;
      let count = 0;
      for (const [original, translated] of Object.entries(mapping)) {
        // Normalize keys for robust matching
        const normalizedKey = original.replace(/\s+/g, ' ').trim();
        translationMap.set(normalizedKey, translated);
        count++;
      }
      log(`Loaded ${count} translation mappings`);
      applyTranslationsToDocument();
    }
  }
});

// MutationObserver to watch for subtitles in the DOM
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList' || mutation.type === 'characterData') {
      const target = mutation.target;

      if (target.nodeType === Node.TEXT_NODE) {
        handleTextNode(target as Text);
      } else if (target instanceof HTMLElement) {
        processElementTree(target);
      }
    }
  });
});

function handleTextNode(textNode: Text) {
  const text = textNode.textContent?.trim();
  if (!text || text.length < 2) return;

  // Strategy: Traverse up ancestors to find the container that matches the full cue text
  // This handles cases where the cue is split into multiple spans or lines in the DOM
  let currentElement: HTMLElement | null = textNode.parentElement;
  let attempts = 0;
  const MAX_LEVELS = 3; // Don't go too high up

  while (currentElement && attempts < MAX_LEVELS) {
    const elementText = currentElement.textContent?.trim();

    if (elementText) {
      const normalizedText = elementText.replace(/\s+/g, ' ').trim();

      if (translationMap.has(normalizedText)) {
        const translatedHtml = translationMap.get(normalizedText);

        if (translatedHtml) {
          // Check if we already replaced it to avoid loops
          // A simple heuristic: if the HTML contains our specific class or structure, 
          // or if the text content is already the translated version.
          // But since we don't have the translated plain text easily, we'll rely on the map check.
          // If the element's text is found in the map, it means it's still the Original French.
          // (Assuming English translation is different enough to not be a key in the French map)

          // log('Replacing subtitle HTML at level', attempts, ':', normalizedText.substring(0, 20) + '...');
          currentElement.innerHTML = translatedHtml;
          return; // Stop once we found and replaced the match
        }
      }
    }

    currentElement = currentElement.parentElement;
    attempts++;
  }
}

// Start observing
// We observe the entire body because we don't know where subtitles are inserted
// But we can try to be more specific if we find the container
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});

// Process any existing subtitles when the content script loads
applyTranslationsToDocument();

log('Arte Subtitle Translator: DOM replacement active');
