export type VttCue = {
  id?: string;
  start: string;
  end: string;
  settings?: string;
  text: string;
};

export type VttDocument = {
  header: string;
  cues: VttCue[];
};

const normalizeVttLines = (vttText: string): string[] => {
  const normalized = vttText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  return normalized.split('\n');
};

const parseTimeLine = (line: string): { start: string; end: string; settings?: string } | null => {
  const [startPart, endAndSettings] = line.split('-->');
  if (!startPart || !endAndSettings) {
    return null;
  }

  const start = startPart.trim();
  if (!start) {
    return null;
  }

  const trimmedRemainder = endAndSettings.trim();
  if (!trimmedRemainder) {
    return null;
  }

  const firstSpaceIndex = trimmedRemainder.indexOf(' ');
  if (firstSpaceIndex === -1) {
    return { start, end: trimmedRemainder };
  }

  const end = trimmedRemainder.slice(0, firstSpaceIndex).trim();
  const settings = trimmedRemainder.slice(firstSpaceIndex + 1).trim();
  return { start, end, settings: settings.length > 0 ? settings : undefined };
};

export const parseVtt = (vttText: string): VttCue[] => {
  const lines = normalizeVttLines(vttText);
  const cues: VttCue[] = [];
  let index = 0;

  const skipBlankLines = () => {
    while (index < lines.length && lines[index]?.trim() === '') {
      index += 1;
    }
  };

  const skipMetadataBlockIfNeeded = (line: string): boolean => {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('WEBVTT')) {
      index += 1;
      return true;
    }

    const isMetadataBlock = upper.startsWith('NOTE') || upper.startsWith('STYLE') || upper.startsWith('REGION');
    if (!isMetadataBlock) {
      return false;
    }

    index += 1;
    while (index < lines.length) {
      const upcomingLine = lines[index];
      const upcomingTrimmed = upcomingLine?.trim() ?? '';
      if (upcomingTrimmed === '') {
        index += 1;
        continue;
      }

      const currentHasTimeline = upcomingLine.includes('-->');
      const nextHasTimeline = lines[index + 1]?.includes('-->');
      if (currentHasTimeline || nextHasTimeline) {
        break;
      }

      index += 1;
    }
    skipBlankLines();
    return true;
  };

  while (index < lines.length) {
    const currentLine = lines[index];
    if (currentLine.trim() === '') {
      index += 1;
      continue;
    }

    if (skipMetadataBlockIfNeeded(currentLine)) {
      continue;
    }

    let id: string | undefined;
    let timeLine = currentLine;
    if (!timeLine.includes('-->')) {
      id = timeLine.trim();
      index += 1;
      if (index >= lines.length) {
        break;
      }
      timeLine = lines[index];
    }

    if (!timeLine.includes('-->')) {
      index += 1;
      continue;
    }

    const parsedTime = parseTimeLine(timeLine);
    if (!parsedTime) {
      index += 1;
      continue;
    }

    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index].trim() !== '') {
      textLines.push(lines[index]);
      index += 1;
    }

    cues.push({
      id: id && id.length > 0 ? id : undefined,
      start: parsedTime.start,
      end: parsedTime.end,
      settings: parsedTime.settings,
      text: textLines.join('\n')
    });

    while (index < lines.length && lines[index].trim() === '') {
      index += 1;
    }
  }

  return cues;
};

export const parseVttWithHeader = (vttText: string): VttDocument => {
  const lines = normalizeVttLines(vttText);
  const headerLines: string[] = [];
  let index = 0;

  // Extract header (WEBVTT + STYLE/NOTE/REGION blocks)
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();

    // Add WEBVTT line
    if (upper.startsWith('WEBVTT')) {
      headerLines.push(line);
      index += 1;
      continue;
    }

    // Check if this is a metadata block
    if (upper.startsWith('STYLE') || upper.startsWith('NOTE') || upper.startsWith('REGION')) {
      headerLines.push(line);
      index += 1;

      // Add all lines until we hit a blank line or a cue
      while (index < lines.length) {
        const nextLine = lines[index];
        const nextTrimmed = nextLine?.trim() ?? '';

        if (nextTrimmed === '') {
          headerLines.push(nextLine);
          index += 1;
          break;
        }

        if (nextLine.includes('-->')) {
          break;
        }

        headerLines.push(nextLine);
        index += 1;
      }
      continue;
    }

    // If it's a blank line in the header section, keep it
    if (trimmed === '' && headerLines.length > 0) {
      headerLines.push(line);
      index += 1;
      continue;
    }

    // If we hit a cue, we're done with the header
    if (line.includes('-->') || (index + 1 < lines.length && lines[index + 1]?.includes('-->'))) {
      break;
    }

    index += 1;
  }

  const header = headerLines.join('\n');
  const cues = parseVtt(vttText);

  return { header, cues };
};

const joinCueLines = (cue: VttCue): string => {
  const lines: string[] = [];
  if (cue.id) {
    lines.push(cue.id);
  }

  const settingsSegment = cue.settings ? ` ${cue.settings}` : '';
  lines.push(`${cue.start} --> ${cue.end}${settingsSegment}`);
  lines.push(...cue.text.split('\n'));
  return lines.join('\n');
};

export const rebuildVtt = (cues: VttCue[]): string => {
  const cueBlocks = cues.map(joinCueLines);
  const body = cueBlocks.join('\n\n');
  const document = body.length > 0 ? `WEBVTT\n\n${body}` : 'WEBVTT';
  return document.endsWith('\n') ? document : `${document}\n`;
};

export const rebuildVttWithHeader = (header: string, cues: VttCue[]): string => {
  const cueBlocks = cues.map(joinCueLines);
  const body = cueBlocks.join('\n\n');

  // Keep the header with STYLE blocks for proper rendering
  const normalizedHeader = header.trim();
  const document = body.length > 0 ? `${normalizedHeader}\n\n${body}` : normalizedHeader;
  return document.endsWith('\n') ? document : `${document}\n`;
};
