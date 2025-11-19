import { describe, expect, it } from 'vitest';
import { translateTexts } from '../src/shared/translation-adapter';

describe('translation adapter', () => {
  it('returns placeholder English translations while preserving empty cues', async () => {
    const result = await translateTexts({
      texts: ['Bonjour', '', ' Salut '],
      sourceLanguage: 'fr',
      targetLanguage: 'en'
    });

    expect(result).toEqual(['[EN] Bonjour', '', '[EN]  Salut ']);
  });
});
