type TranslationRequest = {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
};

const prefixTranslation = (text: string, targetLanguage: string): string => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return '';
  }
  return `[${targetLanguage.toUpperCase()}] ${text}`;
};

export const translateTexts = async (request: TranslationRequest): Promise<string[]> => {
  const { texts, targetLanguage } = request;
  return texts.map((text) => prefixTranslation(text, targetLanguage));
};
