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

  it('skips metadata blocks and malformed sections without throwing', () => {
    const vttText = [
      '\ufeffWEBVTT - Some Title',
      '',
      'NOTE This entire block should be ignored',
      'A metadata line that would otherwise be parsed as text',
      '',
      'STYLE',
      '.highlight { color: yellow; }',
      '',
      'identifier-42',
      '00:01:00.000 --> 00:01:03.000 position:50%',
      'Bonjour <i>Arte</i>',
      'avec style',
      '',
      'This is not a valid time line',
      '',
      '00:02:00.000 --> 00:02:04.000',
      'Deuxième réplique'
    ].join('\n');

    const cues = parseVtt(vttText);
    expect(cues).toEqual([
      {
        id: 'identifier-42',
        start: '00:01:00.000',
        end: '00:01:03.000',
        settings: 'position:50%',
        text: 'Bonjour <i>Arte</i>\navec style'
      },
      {
        start: '00:02:00.000',
        end: '00:02:04.000',
        text: 'Deuxième réplique'
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

  it('round-trips cues without losing text or settings', () => {
    const sourceVtt = [
      'WEBVTT',
      '',
      '2',
      '00:03:00.000 --> 00:03:02.000 align:start',
      'Salut',
      '',
      '3',
      '00:04:00.000 --> 00:04:05.000 line:0%',
      'Encore une fois\nAvec une seconde ligne'
    ].join('\n');

    const cues = parseVtt(sourceVtt);
    const rebuilt = rebuildVtt(cues);
    const reparsed = parseVtt(rebuilt);

    expect(reparsed).toEqual(cues);
  });
});
