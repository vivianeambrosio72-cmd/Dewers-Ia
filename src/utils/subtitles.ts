import type {
  DetectedPause,
  SubtitleSegment,
  WordTiming,
} from '../types';

export function formatTimeDisplay(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatTimePrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.0';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function formatSrtTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms === 1000 ? 999 : ms).padStart(3, '0')}`;
}

export function generateSrtContent(segments: SubtitleSegment[]): string {
  return segments
    .map((seg, index) => {
      const start = formatSrtTimestamp(seg.start);
      const end = formatSrtTimestamp(seg.end);
      return `${index + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`;
    })
    .join('\n');
}

export function detectLongPauses(
  segments: SubtitleSegment[],
  thresholdSeconds: number,
): DetectedPause[] {
  const pauses: DetectedPause[] = [];
  if (segments.length < 2) return pauses;

  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    const gap = next.start - current.end;
    if (gap >= thresholdSeconds) {
      pauses.push({
        id: `pause_${i}_${current.id}`,
        start: Number(current.end.toFixed(3)),
        end: Number(next.start.toFixed(3)),
        duration: Number(gap.toFixed(2)),
        beforeSegmentId: current.id,
        afterSegmentId: next.id,
      });
    }
  }
  return pauses;
}

export function rebuildSegmentWords(
  segment: SubtitleSegment,
  newText: string,
): SubtitleSegment {
  const clean = newText.replace(/\s+/g, ' ').trim();
  if (!clean) return segment;
  const tokens = clean.split(' ').filter(Boolean);
  if (tokens.length === 0) return segment;

  // Preserve original word timings when word count matches
  if (tokens.length === segment.words.length) {
    const updatedWords: WordTiming[] = segment.words.map((w, i) => {
      const changed = tokens[i] !== w.text;
      return {
        ...w,
        text: tokens[i],
        ...(changed ? { confidence: 1, needsReview: false } : {}),
      };
    });
    return {
      ...segment,
      text: clean,
      words: updatedWords,
    };
  }

  // Redistribute [segment.start, segment.end] proportionally by character length
  const totalChars = tokens.reduce((acc, t) => acc + Math.max(1, t.length), 0);
  const totalDur = Math.max(0.2, segment.end - segment.start);
  let cursor = segment.start;

  const updatedWords: WordTiming[] = tokens.map((tok, i) => {
    const weight = Math.max(1, tok.length) / totalChars;
    const wDur = i === tokens.length - 1 ? segment.end - cursor : totalDur * weight;
    const wStart = cursor;
    const wEnd = Math.min(segment.end, cursor + Math.max(0.05, wDur));
    cursor = wEnd;
    return {
      id: `${segment.id}_w_${i}_${Math.random().toString(36).slice(2, 5)}`,
      text: tok,
      start: Number(wStart.toFixed(3)),
      end: Number(Math.max(wStart + 0.05, wEnd).toFixed(3)),
      confidence: 1,
      needsReview: false,
    };
  });

  return {
    ...segment,
    text: clean,
    words: updatedWords,
  };
}

export function editSingleWordInSegment(
  segment: SubtitleSegment,
  wordId: string,
  newWordText: string,
): SubtitleSegment {
  const clean = newWordText.replace(/\s+/g, ' ').trim();
  const targetIdx = segment.words.findIndex((w) => w.id === wordId);
  if (targetIdx === -1) return segment;

  const target = segment.words[targetIdx];
  if (!clean) {
    if (segment.words.length <= 1) return segment;
    const remaining = segment.words.filter((w) => w.id !== wordId);
    return {
      ...segment,
      text: remaining.map((w) => w.text).join(' '),
      start: remaining[0].start,
      end: remaining[remaining.length - 1].end,
      words: remaining,
    };
  }

  const tokens = clean.split(' ').filter(Boolean);
  if (tokens.length === 1) {
    // Keep exact original start & end timing of this word
    const nextWords = segment.words.map((w) =>
      w.id === wordId
        ? { ...w, text: tokens[0], confidence: 1, needsReview: false }
        : w,
    );
    return {
      ...segment,
      text: nextWords.map((w) => w.text).join(' '),
      words: nextWords,
    };
  }

  // If user typed multiple words in one word slot, subdivide that word's time window proportionally
  const totalChars = tokens.reduce((acc, t) => acc + Math.max(1, t.length), 0);
  const wDurTotal = Math.max(0.1, target.end - target.start);
  let cursor = target.start;
  const expanded: WordTiming[] = tokens.map((tok, i) => {
    const share = (Math.max(1, tok.length) / totalChars) * wDurTotal;
    const s = cursor;
    const e = i === tokens.length - 1 ? target.end : Math.min(target.end, cursor + Math.max(0.04, share));
    cursor = e;
    return {
      id: `${wordId}_sub_${i}_${Math.random().toString(36).slice(2, 5)}`,
      text: tok,
      start: Number(s.toFixed(3)),
      end: Number(Math.max(s + 0.04, e).toFixed(3)),
      confidence: 1,
      needsReview: false,
    };
  });

  const nextWords = [
    ...segment.words.slice(0, targetIdx),
    ...expanded,
    ...segment.words.slice(targetIdx + 1),
  ];
  return {
    ...segment,
    text: nextWords.map((w) => w.text).join(' '),
    words: nextWords,
  };
}

export function markWordReviewedInSegment(
  segment: SubtitleSegment,
  wordId: string,
): SubtitleSegment {
  const nextWords = segment.words.map((w) =>
    w.id === wordId ? { ...w, confidence: 1, needsReview: false } : w,
  );
  return { ...segment, words: nextWords };
}

export function splitSegmentAtWordIndex(
  segment: SubtitleSegment,
  splitIndex: number,
): [SubtitleSegment, SubtitleSegment] | null {
  if (segment.words.length < 2) return null;
  const clampedIdx = Math.max(1, Math.min(segment.words.length - 1, splitIndex));
  const leftWords = segment.words.slice(0, clampedIdx);
  const rightWords = segment.words.slice(clampedIdx);
  const suffix = Math.random().toString(36).slice(2, 6);

  const leftSeg: SubtitleSegment = {
    id: `${segment.id}_a_${suffix}`,
    text: leftWords.map((w) => w.text).join(' '),
    start: leftWords[0].start,
    end: leftWords[leftWords.length - 1].end,
    words: leftWords,
  };
  const rightSeg: SubtitleSegment = {
    id: `${segment.id}_b_${suffix}`,
    text: rightWords.map((w) => w.text).join(' '),
    start: rightWords[0].start,
    end: Math.max(rightWords[rightWords.length - 1].end, rightWords[0].start + 0.15),
    words: rightWords,
  };

  return [leftSeg, rightSeg];
}

export function splitSegmentByCharOffset(
  segment: SubtitleSegment,
  cursorPos: number,
): [SubtitleSegment, SubtitleSegment] | null {
  if (segment.words.length < 2) return null;
  let charAcc = 0;
  let splitIdx = Math.floor(segment.words.length / 2);

  for (let i = 0; i < segment.words.length; i++) {
    const wordLen = segment.words[i].text.length;
    const wordEndOffset = charAcc + wordLen;
    if (cursorPos <= wordEndOffset + 1) {
      splitIdx = i === 0 ? 1 : i;
      break;
    }
    charAcc = wordEndOffset + 1;
  }

  return splitSegmentAtWordIndex(segment, splitIdx);
}

export function mergeTwoSegments(
  first: SubtitleSegment,
  second: SubtitleSegment,
): SubtitleSegment {
  const combinedWords = [...first.words, ...second.words].sort(
    (a, b) => a.start - b.start,
  );
  return {
    id: first.id,
    text: combinedWords.map((w) => w.text).join(' '),
    start: combinedWords[0]?.start ?? first.start,
    end: Math.max(first.end, second.end, combinedWords[combinedWords.length - 1]?.end ?? second.end),
    words: combinedWords,
  };
}

export function updateSegmentTimeRange(
  segment: SubtitleSegment,
  rawStart: number,
  rawEnd: number,
  maxDuration?: number,
): SubtitleSegment {
  const limit = maxDuration && maxDuration > 0 ? maxDuration : 3600;
  const clampedStart = Math.max(0, Math.min(limit - 0.15, Number(rawStart.toFixed(3))));
  const clampedEnd = Math.max(
    clampedStart + 0.15,
    Math.min(limit, Number(rawEnd.toFixed(3))),
  );

  const oldStart = segment.start;
  const oldSpan = Math.max(0.05, segment.end - segment.start);
  const newSpan = clampedEnd - clampedStart;

  const rescaledWords: WordTiming[] = segment.words.map((w, idx) => {
    const relStart = (w.start - oldStart) / oldSpan;
    const relEnd = (w.end - oldStart) / oldSpan;
    const s = Math.max(clampedStart, Math.min(clampedEnd - 0.04, clampedStart + relStart * newSpan));
    const e =
      idx === segment.words.length - 1
        ? clampedEnd
        : Math.max(s + 0.04, Math.min(clampedEnd, clampedStart + relEnd * newSpan));
    return {
      ...w,
      start: Number(s.toFixed(3)),
      end: Number(e.toFixed(3)),
    };
  });

  return {
    ...segment,
    start: clampedStart,
    end: clampedEnd,
    words: rescaledWords,
  };
}

export function createSegmentAtTime(
  segments: SubtitleSegment[],
  atTime: number,
  videoDuration: number,
): SubtitleSegment[] {
  const safeDur = Math.max(1, videoDuration || 10);
  const start = Math.max(0, Math.min(safeDur - 0.4, Number(atTime.toFixed(3))));
  const nextSeg = segments.find((s) => s.start > start + 0.25);
  const maxEnd = nextSeg ? Math.min(safeDur, nextSeg.start - 0.05) : safeDur;
  const end = Number(Math.max(start + 0.4, Math.min(maxEnd, start + 1.8)).toFixed(3));
  const mid = Number(((start + end) / 2).toFixed(3));
  const id = `seg_new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const created: SubtitleSegment = {
    id,
    text: 'Nova legenda',
    start,
    end,
    words: [
      { id: `${id}_w0`, text: 'Nova', start, end: mid, confidence: 1, needsReview: false },
      { id: `${id}_w1`, text: 'legenda', start: mid, end, confidence: 1, needsReview: false },
    ],
  };

  return [...segments, created].sort((a, b) => a.start - b.start);
}

export function findAndReplaceInSegments(
  segments: SubtitleSegment[],
  searchQuery: string,
  replacement: string,
): { nextSegments: SubtitleSegment[]; matchCount: number } {
  const needle = searchQuery.trim();
  if (!needle) return { nextSegments: segments, matchCount: 0 };

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'gi');
  let matchCount = 0;

  const nextSegments = segments.map((seg) => {
    const matches = seg.text.match(regex);
    if (!matches || matches.length === 0) return seg;
    matchCount += matches.length;
    const replacedText = seg.text.replace(regex, replacement);
    return rebuildSegmentWords(seg, replacedText);
  });

  return { nextSegments, matchCount };
}

export interface ReviewWordTarget {
  segmentId: string;
  wordId: string;
  text: string;
  start: number;
}

export function getReviewWordsList(segments: SubtitleSegment[]): ReviewWordTarget[] {
  const list: ReviewWordTarget[] = [];
  for (const seg of segments) {
    for (const w of seg.words) {
      if (w.needsReview) {
        list.push({
          segmentId: seg.id,
          wordId: w.id,
          text: w.text,
          start: w.start,
        });
      }
    }
  }
  return list;
}

export function getActiveTransitionState(
  currentTime: number,
  pauses: DetectedPause[],
  enabled: boolean,
  mode: 'transition' | 'cut',
  transitionDuration = 0.45,
): {
  activePause: DetectedPause | null;
  progress: number;
} {
  if (!enabled || mode !== 'transition' || pauses.length === 0) {
    return { activePause: null, progress: 0 };
  }

  const dur = Math.min(2.0, Math.max(0.15, transitionDuration));
  const halfPre = dur * 0.72;
  const halfPost = dur * 0.28;

  for (const pause of pauses) {
    const triggerStart = Math.max(pause.start - 0.05, pause.end - halfPre);
    const triggerEnd = pause.end + halfPost;
    if (currentTime >= triggerStart && currentTime <= triggerEnd) {
      const progress = Math.min(
        1,
        Math.max(0, (currentTime - triggerStart) / Math.max(0.05, triggerEnd - triggerStart)),
      );
      return { activePause: pause, progress };
    }
  }

  return { activePause: null, progress: 0 };
}

export function buildAutoTransitionPoints(
  segments: SubtitleSegment[],
  thresholdSeconds: number,
  defaultType: import('../types').TransitionType,
  defaultDuration: number,
  defaultIntensity: import('../types').TransitionIntensity,
): import('../types').TransitionPoint[] {
  const pauses = detectLongPauses(segments, thresholdSeconds);
  return pauses.map((pause, index) => ({
    id: `tp_auto_${index}_${pause.afterSegmentId}`,
    time: pause.end,
    type: defaultType,
    duration: defaultDuration,
    intensity: defaultIntensity,
    source: 'auto' as const,
    pauseDuration: pause.duration,
  }));
}

export function getActivePointTransition(
  currentTime: number,
  points: import('../types').TransitionPoint[],
  enabled: boolean,
): {
  activePoint: import('../types').TransitionPoint | null;
  progress: number;
} {
  if (!enabled || points.length === 0) {
    return { activePoint: null, progress: 0 };
  }

  for (const pt of points) {
    const dur = Math.min(2.0, Math.max(0.15, pt.duration || 0.45));
    const triggerStart = Math.max(0, pt.time - dur * 0.72);
    const triggerEnd = pt.time + dur * 0.28;
    if (currentTime >= triggerStart && currentTime <= triggerEnd) {
      const progress = Math.min(
        1,
        Math.max(0, (currentTime - triggerStart) / Math.max(0.05, triggerEnd - triggerStart)),
      );
      return { activePoint: pt, progress };
    }
  }

  return { activePoint: null, progress: 0 };
}

export interface ActiveWordChunk {
  chunkId: string;
  start: number;
  end: number;
  words: WordTiming[];
  activeWordIndex: number;
}

/**
 * Splits any segment into sub-groups of at most 4 words (preferring 2-4 words)
 * and returns the active chunk + active word index at `currentTime`.
 */
export function getActiveWordChunk(
  segments: SubtitleSegment[],
  currentTime: number,
): ActiveWordChunk | null {
  const seg = segments.find(
    (s) => currentTime >= s.start && currentTime <= s.end + 0.06,
  );
  if (!seg || seg.words.length === 0) return null;

  const words = seg.words;
  const maxPerGroup = 4;
  const groups: WordTiming[][] = [];

  if (words.length <= maxPerGroup) {
    groups.push(words);
  } else {
    let i = 0;
    while (i < words.length) {
      const remaining = words.length - i;
      if (remaining === 5) {
        groups.push(words.slice(i, i + 3));
        groups.push(words.slice(i + 3, i + 5));
        break;
      }
      const take = Math.min(maxPerGroup, remaining);
      groups.push(words.slice(i, i + take));
      i += take;
    }
  }

  for (let gIdx = 0; gIdx < groups.length; gIdx++) {
    const grp = groups[gIdx];
    const gStart = grp[0].start;
    const gEnd = grp[grp.length - 1].end;
    const isLast = gIdx === groups.length - 1;
    const nextStart = !isLast ? groups[gIdx + 1][0].start : gEnd + 0.06;

    if (currentTime >= gStart - 0.01 && currentTime < (isLast ? gEnd + 0.06 : nextStart)) {
      let activeIdx = grp.findIndex(
        (w) => currentTime >= w.start && currentTime <= w.end,
      );
      if (activeIdx === -1) {
        for (let k = grp.length - 1; k >= 0; k--) {
          if (currentTime >= grp[k].start) {
            activeIdx = k;
            break;
          }
        }
      }
      return {
        chunkId: `${seg.id}_chunk_${gIdx}`,
        start: gStart,
        end: gEnd,
        words: grp,
        activeWordIndex: activeIdx,
      };
    }
  }

  const lastGrp = groups[groups.length - 1];
  return {
    chunkId: `${seg.id}_chunk_${groups.length - 1}`,
    start: lastGrp[0].start,
    end: lastGrp[lastGrp.length - 1].end,
    words: lastGrp,
    activeWordIndex: lastGrp.length - 1,
  };
}
