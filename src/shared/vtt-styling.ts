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
    // If there are no tags in the original, just return the translated text
    if (!original.includes('<')) {
        return translatedPlainText;
    }

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

    // Extract original plain text (without tags)
    const originalPlainText = segments
        .filter(s => s.type === 'text')
        .map(s => s.content)
        .join('');

    // If there's no text, return original
    if (originalPlainText.trim().length === 0) {
        return original;
    }

    // Simple replacement: replace all text content with translated text
    // while keeping all tags in their original positions
    let result = '';
    let translatedTextUsed = false;

    for (const segment of segments) {
        if (segment.type === 'tag') {
            result += segment.content;
        } else if (!translatedTextUsed) {
            // Replace the first text segment with the full translated text
            result += translatedPlainText;
            translatedTextUsed = true;
        }
        // Skip other text segments (they're part of the original we're replacing)
    }

    return result;
};
