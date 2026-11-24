export interface PreparedAudioPart {
  file: File;
  startTime: number;
  duration: number;
}

export interface PreparedAudioResult {
  isSilent: boolean;
  audioFile: File | null;
  audioParts: PreparedAudioPart[];
  decodeError?: string;
}

const MAX_CLIENT_DECODE_BYTES = 250 * 1024 * 1024; // 250 MB

function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function resampleBufferLinearMono(
  decoded: AudioBuffer,
  targetRate: number,
): Float32Array {
  const numChannels = Math.max(1, decoded.numberOfChannels);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(decoded.getChannelData(c));
  }

  const srcLen = decoded.length;
  const srcRate = decoded.sampleRate;
  const targetLen = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const out = new Float32Array(targetLen);
  const ratio = srcRate / targetRate;

  for (let i = 0; i < targetLen; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.min(srcLen - 1, Math.floor(srcPos));
    const idx1 = Math.min(srcLen - 1, idx0 + 1);
    const frac = srcPos - idx0;

    let sum = 0;
    for (let c = 0; c < numChannels; c++) {
      const ch = channels[c];
      sum += ch[idx0] * (1 - frac) + ch[idx1] * frac;
    }
    out[i] = sum / numChannels;
  }

  return out;
}

async function renderMonoSamples(
  decoded: AudioBuffer,
  targetRate: number,
): Promise<Float32Array> {
  if (typeof OfflineAudioContext !== 'undefined') {
    try {
      const targetLength = Math.max(1, Math.ceil(decoded.duration * targetRate));
      const offlineCtx = new OfflineAudioContext(1, targetLength, targetRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineCtx.destination);
      source.start(0);
      const rendered = await offlineCtx.startRendering();
      return rendered.getChannelData(0);
    } catch {
      // Fallback for huge durations or browser OfflineAudioContext limits
    }
  }
  return resampleBufferLinearMono(decoded, targetRate);
}

/**
 * Finds the quietest boundary near targetSplitSample (±4s) so chunks split
 * between pauses/words rather than mid-syllable.
 */
function findQuietSplitSample(
  samples: Float32Array,
  sampleRate: number,
  minStartSample: number,
  idealSplitSample: number,
  maxAllowedSample: number,
): number {
  const searchRadius = Math.floor(4 * sampleRate);
  const minBound = Math.max(minStartSample + Math.floor(sampleRate * 5), idealSplitSample - searchRadius);
  const maxBound = Math.min(maxAllowedSample, idealSplitSample + searchRadius);

  if (maxBound <= minBound) {
    return Math.min(maxAllowedSample, idealSplitSample);
  }

  const windowSize = Math.max(1, Math.floor(0.06 * sampleRate)); // 60 ms energy window
  const step = Math.max(1, Math.floor(0.03 * sampleRate)); // 30 ms step

  let bestPos = Math.min(maxAllowedSample, idealSplitSample);
  let lowestAvgEnergy = Infinity;

  for (let pos = minBound; pos <= maxBound - windowSize; pos += step) {
    let energy = 0;
    for (let j = 0; j < windowSize; j += 4) {
      energy += Math.abs(samples[pos + j]);
    }
    const avg = energy / Math.ceil(windowSize / 4);
    if (avg < lowestAvgEnergy) {
      lowestAvgEnergy = avg;
      bestPos = pos + Math.floor(windowSize / 2);
    }
  }

  return bestPos;
}

/**
 * Decodes video audio locally in-browser (for files up to 250 MB) to:
 * 1) Detect completely silent videos immediately before upload
 * 2) Produce lightweight 12–16 kHz mono WAV audio, automatically slicing long videos
 *    into small WAV parts that stay safely under Vercel's 4.5 MB serverless limit.
 */
export async function prepareAudioForTranscription(
  file: File,
  maxWavBytes: number = 14 * 1024 * 1024,
  maxPartDurationSec: number = 180,
): Promise<PreparedAudioResult> {
  if (file.size > MAX_CLIENT_DECODE_BYTES) {
    return {
      isSilent: false,
      audioFile: null,
      audioParts: [],
      decodeError: 'Arquivo maior que 250 MB para decodificação no navegador.',
    };
  }

  let audioCtx: AudioContext | null = null;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      return {
        isSilent: false,
        audioFile: null,
        audioParts: [],
        decodeError: 'Web Audio API indisponível neste navegador.',
      };
    }

    audioCtx = new AudioCtx();
    let rawBuffer: ArrayBuffer | null = await file.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(rawBuffer);
    rawBuffer = null;

    await audioCtx.close().catch(() => {});
    audioCtx = null;

    // Check peak amplitude across all channels to detect silent audio
    let peak = 0;
    const numChannels = Math.max(1, decoded.numberOfChannels);
    for (let c = 0; c < numChannels; c++) {
      const ch = decoded.getChannelData(c);
      const step = Math.max(1, Math.floor(ch.length / 24000));
      for (let i = 0; i < ch.length; i += step) {
        const v = Math.abs(ch[i]);
        if (v > peak) peak = v;
        if (peak > 0.002) break;
      }
      if (peak > 0.002) break;
    }

    if (peak <= 0.0005) {
      return { isSilent: true, audioFile: null, audioParts: [] };
    }

    // Use 16 kHz for normal videos, or 12 kHz for very long videos (> 8 min) to minimize memory
    const selectedRate = decoded.duration > 480 ? 12000 : 16000;
    const monoSamples = await renderMonoSamples(decoded, selectedRate);
    const totalSamples = monoSamples.length;

    const maxSamplesByBytes = Math.max(
      selectedRate * 10,
      Math.floor((maxWavBytes - 44) / 2),
    );
    const maxSamplesByDuration = Math.max(
      selectedRate * 10,
      Math.floor(maxPartDurationSec * selectedRate),
    );
    const maxSamplesPerPart = Math.min(maxSamplesByBytes, maxSamplesByDuration);

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'audio';

    // Fast path: allow slightly larger single chunk (up to 1.25x duration if still under byte limit)
    // so ~60s reels finish in a single API call
    const singlePartCeiling = Math.min(
      maxSamplesByBytes,
      Math.floor(maxSamplesByDuration * 1.25),
    );
    if (totalSamples <= singlePartCeiling) {
      const wavBlob = encodeMonoWav(monoSamples, selectedRate);
      const wavFile = new File([wavBlob], `${baseName}.wav`, {
        type: 'audio/wav',
      });
      return {
        isSilent: false,
        audioFile: wavFile,
        audioParts: [
          {
            file: wavFile,
            startTime: 0,
            duration: totalSamples / selectedRate,
          },
        ],
      };
    }

    // Multi-part slicing along silence valleys
    const parts: PreparedAudioPart[] = [];
    let cursor = 0;
    let partIndex = 0;

    while (cursor < totalSamples) {
      const remaining = totalSamples - cursor;
      let endSample = totalSamples;

      if (remaining > maxSamplesPerPart) {
        // Leave room for trailing tail; never leave a tiny < 5s orphan at the end
        const idealSplit = cursor + Math.floor(maxSamplesPerPart * 0.92);
        const maxAllowed = cursor + maxSamplesPerPart;
        endSample = findQuietSplitSample(
          monoSamples,
          selectedRate,
          cursor,
          idealSplit,
          maxAllowed,
        );
        if (totalSamples - endSample < selectedRate * 4) {
          // If remaining tail is tiny and fits under maxBytes, absorb or adjust slightly earlier
          if (totalSamples - cursor <= maxSamplesByBytes) {
            endSample = totalSamples;
          }
        }
      }

      const slice = monoSamples.subarray(cursor, endSample);
      if (slice.length >= selectedRate * 0.1) {
        const wavBlob = encodeMonoWav(slice, selectedRate);
        const wavFile = new File(
          [wavBlob],
          `${baseName}_part_${partIndex + 1}.wav`,
          { type: 'audio/wav' },
        );
        parts.push({
          file: wavFile,
          startTime: Number((cursor / selectedRate).toFixed(3)),
          duration: Number((slice.length / selectedRate).toFixed(3)),
        });
        partIndex += 1;
      }

      cursor = endSample;
    }

    return {
      isSilent: false,
      audioFile: parts.length === 1 ? parts[0].file : null,
      audioParts: parts,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      isSilent: false,
      audioFile: null,
      audioParts: [],
      decodeError: errMsg,
    };
  } finally {
    if (audioCtx) {
      await audioCtx.close().catch(() => {});
    }
  }
}
