import { describe, expect, it } from 'vitest';
import { parseVtt, rebuildVtt, type VttCue } from '../src/shared/vtt';

describe('VTT utilities', () => {
  it('parses cue identifiers, timings, settings, and multi-line text', () => {
    const vttText = [
      'WEBVTT',
      '',
      'NOTE metadata line',
      '1',
      '00:00:00.000 --> 00:00:01.000 align:start position:10%',
      'Bonjour',
      'le monde',
      '',
      '00:00:02.000 --> 00:00:03.000',
      'Salut'
    ].join('\n');

    const cues = parseVtt(vttText);
    expect(cues).toEqual([
      {
        id: '1',
        start: '00:00:00.000',
        end: '00:00:01.000',
        settings: 'align:start position:10%',
        text: 'Bonjour\nle monde'
      },
      {
        id: undefined,
        start: '00:00:02.000',
        end: '00:00:03.000',
        settings: undefined,
        text: 'Salut'
      }
    ] satisfies VttCue[]);
  });

  it('rebuilds cues into valid VTT text with preserved metadata', () => {
    const cues: VttCue[] = [
      {
        id: 'intro',
        start: '00:00:00.000',
        end: '00:00:02.000',
        settings: 'align:end',
        text: 'Hello\nWorld'
      }
    ];

    const rebuilt = rebuildVtt(cues);
    expect(rebuilt.startsWith('WEBVTT\n\nintro')).toBe(true);
    expect(rebuilt).toContain('00:00:00.000 --> 00:00:02.000 align:end');
    expect(rebuilt.trimEnd()).toMatch(/Hello\nWorld$/);
  });
});
