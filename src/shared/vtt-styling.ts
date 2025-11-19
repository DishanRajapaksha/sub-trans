/**
 * Extracts plain text from VTT cue text that may contain styling tags
 * Example: "<c.cyan.bg_black>Hello</c>" => "Hello"
 */
export const extractPlainText = (vttText: string): string => {
    // Remove all VTT tags like <c.class>, </c>, <v Speaker>, etc.
    return vttText.replace(/<[^>]+>/g, '');
};

/**
 * Replaces the plain text content within VTT styling tags
 * Preserves all tags and only replaces the text between them
 */
export const replaceTextPreservingTags = (original: string, translatedPlainText: string): string => {
    // Split the original into segments of tags and text
    const segments: Array<{ type: 'tag' | 'text'; content: string }> = [];
    let currentIndex = 0;
    const tagRegex = /<[^>]+>/g;
    let match;

    while ((match = tagRegex.exec(original)) !== null) {
        // Add text before the tag
        if (match.index > currentIndex) {
            segments.push({
                type: 'text',
                content: original.slice(currentIndex, match.index)
            });
        }

        // Add the tag
        segments.push({
            type: 'tag',
            content: match[0]
        });

        currentIndex = match.index + match[0].length;
    }

    // Add remaining text after last tag
    if (currentIndex < original.length) {
        segments.push({
            type: 'text',
            content: original.slice(currentIndex)
        });
    }

    // If no tags found, just return the translated text
    if (segments.length === 0) {
        return translatedPlainText;
    }

    // Extract original plain text segments
    const originalTextSegments = segments
        .filter(s => s.type === 'text')
        .map(s => s.content);

    // If there's no text, return as is
    if (originalTextSegments.length === 0) {
        return original;
    }

    // Split translated text proportionally to match original segments
    // For simplicity, we'll just replace all text with the translated version
    // while keeping the tag structure
    const translatedWords = translatedPlainText.split(/\s+/);
    const originalWords = originalTextSegments.join('').split(/\s+/).filter(w => w.length > 0);

    // If word counts don't match, we need a different strategy
    // For now, distribute translated words evenly across text segments
    let wordIndex = 0;
    const wordsPerSegment = Math.ceil(translatedWords.length / originalTextSegments.length);

    const translatedSegments = originalTextSegments.map((_, i) => {
        const segmentWords = translatedWords.slice(wordIndex, wordIndex + wordsPerSegment);
        wordIndex += wordsPerSegment;
        return segmentWords.join(' ');
    });

    // Rebuild the text with tags
    let result = '';
    let textSegmentIndex = 0;

    for (const segment of segments) {
        if (segment.type === 'tag') {
            result += segment.content;
        } else {
            result += translatedSegments[textSegmentIndex] || '';
            textSegmentIndex++;
        }
    }

    return result;
};
