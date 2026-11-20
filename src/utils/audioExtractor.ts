export interface PreparedAudioResult {
  isSilent: boolean;
  audioFile: File | null;
}

const MAX_CLIENT_DECODE_BYTES = 45 * 1024 * 1024; // 45 MB

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

/**
 * Decodes video audio once in-browser (for files <= 45 MB) to:
 * 1) Detect completely silent videos immediately before upload
 * 2) Produce a lightweight 16 kHz mono WAV (~1.9 MB/min) for fast Gemini transcription
 */
export async function prepareAudioForTranscription(
  file: File,
): Promise<PreparedAudioResult> {
  if (file.size > MAX_CLIENT_DECODE_BYTES) {
    return { isSilent: false, audioFile: null };
  }

  let audioCtx: AudioContext | null = null;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      return { isSilent: false, audioFile: null };
    }

    audioCtx = new AudioCtx();
    const rawBuffer = await file.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(rawBuffer.slice(0));

    // Check peak amplitude across channels to detect silent audio
    let peak = 0;
    const ch0 = decoded.getChannelData(0);
    const step = Math.max(1, Math.floor(ch0.length / 24000));
    for (let i = 0; i < ch0.length; i += step) {
      const v = Math.abs(ch0[i]);
      if (v > peak) peak = v;
      if (peak > 0.002) break;
    }

    if (peak <= 0.0005) {
      return { isSilent: true, audioFile: null };
    }

    // Downsample to 16 kHz mono WAV if supported and reasonably sized (<= 15 MB WAV ~ 7.5 min)
    const targetRate = 16000;
    const targetLength = Math.max(1, Math.ceil(decoded.duration * targetRate));
    if (
      typeof OfflineAudioContext === 'undefined' ||
      targetLength * 2 + 44 > 15 * 1024 * 1024
    ) {
      return { isSilent: false, audioFile: null };
    }

    const offlineCtx = new OfflineAudioContext(1, targetLength, targetRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineCtx.destination);
    source.start(0);
    const rendered = await offlineCtx.startRendering();
    const monoSamples = rendered.getChannelData(0);
    const wavBlob = encodeMonoWav(monoSamples, targetRate);

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'audio';
    const wavFile = new File([wavBlob], `${baseName}.wav`, {
      type: 'audio/wav',
    });

    return { isSilent: false, audioFile: wavFile };
  } catch {
    // Codec not decodable by Web Audio API -> fall back to uploading original video file
    return { isSilent: false, audioFile: null };
  } finally {
    if (audioCtx) {
      await audioCtx.close().catch(() => {});
    }
  }
}
