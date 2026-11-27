import type { NoiseReductionConfig, NoiseReductionLevel } from '../types';

interface NoisePresetParams {
  highpassHz: number;
  lowpassHz: number;
  mudCutDb: number;
  presenceBoostDb: number;
  gateThresholdRms: number;
  gateFloorGain: number;
  compressorThresholdDb: number;
  compressorRatio: number;
}

export const NOISE_REDUCTION_PRESETS: Record<
  NoiseReductionLevel,
  NoisePresetParams
> = {
  light: {
    highpassHz: 95,
    lowpassHz: 9500,
    mudCutDb: -2,
    presenceBoostDb: 2,
    gateThresholdRms: 0.008,
    gateFloorGain: 0.28,
    compressorThresholdDb: -24,
    compressorRatio: 2.2,
  },
  medium: {
    highpassHz: 140,
    lowpassHz: 7200,
    mudCutDb: -3.5,
    presenceBoostDb: 3,
    gateThresholdRms: 0.015,
    gateFloorGain: 0.14,
    compressorThresholdDb: -22,
    compressorRatio: 2.8,
  },
  strong: {
    highpassHz: 190,
    lowpassHz: 5200,
    mudCutDb: -5,
    presenceBoostDb: 3.8,
    gateThresholdRms: 0.025,
    gateFloorGain: 0.06,
    compressorThresholdDb: -20,
    compressorRatio: 3.5,
  },
};

export interface NoiseReductionGraphHandle {
  updateConfig: (config: NoiseReductionConfig) => void;
  resumeIfSuspended: () => Promise<void>;
  dispose: () => void;
}

/**
 * Attaches a switchable dry/wet Web Audio DSP chain (high-pass rumble removal,
 * boxy mud cut, vocal presence clarity, de-hiss low-pass, gentle voice compressor,
 * and smooth RMS noise gate) to an arbitrary AudioNode source.
 */
export function attachNoiseReductionChain(
  ctx: AudioContext,
  sourceNode: AudioNode,
  destinationNode: AudioNode,
  initialConfig: NoiseReductionConfig,
): NoiseReductionGraphHandle {
  let currentConfig: NoiseReductionConfig = { ...initialConfig };
  let disposed = false;

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.Q.value = 0.75;

  const mudCut = ctx.createBiquadFilter();
  mudCut.type = 'peaking';
  mudCut.frequency.value = 260;
  mudCut.Q.value = 1.2;

  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2800;
  presence.Q.value = 1.0;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.Q.value = 0.8;

  const compressor = ctx.createDynamicsCompressor();
  compressor.knee.value = 18;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.18;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  const gateGain = ctx.createGain();
  gateGain.gain.value = 1;

  // Dry bypass route
  sourceNode.connect(dryGain);
  dryGain.connect(destinationNode);

  // Wet denoised route
  sourceNode.connect(highpass);
  highpass.connect(mudCut);
  mudCut.connect(presence);
  presence.connect(lowpass);
  lowpass.connect(analyser);
  analyser.connect(gateGain);
  gateGain.connect(compressor);
  compressor.connect(wetGain);
  wetGain.connect(destinationNode);

  const applyParams = (cfg: NoiseReductionConfig) => {
    const preset = NOISE_REDUCTION_PRESETS[cfg.level] || NOISE_REDUCTION_PRESETS.medium;
    const now = ctx.currentTime;

    highpass.frequency.setTargetAtTime(preset.highpassHz, now, 0.02);
    mudCut.gain.setTargetAtTime(preset.mudCutDb, now, 0.02);
    presence.gain.setTargetAtTime(preset.presenceBoostDb, now, 0.02);
    lowpass.frequency.setTargetAtTime(preset.lowpassHz, now, 0.02);
    compressor.threshold.setTargetAtTime(preset.compressorThresholdDb, now, 0.02);
    compressor.ratio.setTargetAtTime(preset.compressorRatio, now, 0.02);

    dryGain.gain.setTargetAtTime(cfg.enabled ? 0 : 1, now, 0.025);
    wetGain.gain.setTargetAtTime(cfg.enabled ? 1 : 0, now, 0.025);
    if (!cfg.enabled) {
      gateGain.gain.setTargetAtTime(1, now, 0.02);
    }
  };

  applyParams(currentConfig);

  const sampleBuffer = new Float32Array(analyser.fftSize);
  let holdUntilMs = 0;

  const gateInterval = window.setInterval(() => {
    if (disposed || !currentConfig.enabled || ctx.state !== 'running') {
      return;
    }
    const preset =
      NOISE_REDUCTION_PRESETS[currentConfig.level] ||
      NOISE_REDUCTION_PRESETS.medium;

    analyser.getFloatTimeDomainData(sampleBuffer);
    let sumSq = 0;
    for (let i = 0; i < sampleBuffer.length; i++) {
      const s = sampleBuffer[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / sampleBuffer.length);
    const nowMs = performance.now();
    const nowAudio = ctx.currentTime;

    if (rms >= preset.gateThresholdRms) {
      holdUntilMs = nowMs + 160;
      gateGain.gain.setTargetAtTime(1, nowAudio, 0.008);
    } else if (nowMs > holdUntilMs) {
      gateGain.gain.setTargetAtTime(preset.gateFloorGain, nowAudio, 0.045);
    }
  }, 25);

  return {
    updateConfig(nextConfig: NoiseReductionConfig) {
      currentConfig = { ...nextConfig };
      applyParams(currentConfig);
    },
    async resumeIfSuspended() {
      if (!disposed && ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.clearInterval(gateInterval);
      try {
        dryGain.disconnect();
        wetGain.disconnect();
        highpass.disconnect();
        mudCut.disconnect();
        presence.disconnect();
        lowpass.disconnect();
        analyser.disconnect();
        gateGain.disconnect();
        compressor.disconnect();
      } catch {
        // ignore disconnect errors on teardown
      }
    },
  };
}

/**
 * Applies the same spectral filtering + smooth RMS noise gate offline to mono PCM
 * samples (used before AI transcription WAV encoding when noise reduction is enabled).
 */
export async function applyOfflineNoiseReduction(
  samples: Float32Array,
  sampleRate: number,
  config: NoiseReductionConfig,
): Promise<Float32Array> {
  if (!config.enabled || samples.length === 0) {
    return samples;
  }

  const preset =
    NOISE_REDUCTION_PRESETS[config.level] || NOISE_REDUCTION_PRESETS.medium;
  let filtered = samples;

  if (typeof OfflineAudioContext !== 'undefined') {
    try {
      const offline = new OfflineAudioContext(1, samples.length, sampleRate);
      const buffer = offline.createBuffer(1, samples.length, sampleRate);
      const channelData = buffer.getChannelData(0);
      channelData.set(samples);

      const src = offline.createBufferSource();
      src.buffer = buffer;

      const highpass = offline.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = preset.highpassHz;
      highpass.Q.value = 0.75;

      const mudCut = offline.createBiquadFilter();
      mudCut.type = 'peaking';
      mudCut.frequency.value = 260;
      mudCut.Q.value = 1.2;
      mudCut.gain.value = preset.mudCutDb;

      const presence = offline.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 2800;
      presence.Q.value = 1.0;
      presence.gain.value = preset.presenceBoostDb;

      const lowpass = offline.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = preset.lowpassHz;
      lowpass.Q.value = 0.8;

      src.connect(highpass);
      highpass.connect(mudCut);
      mudCut.connect(presence);
      presence.connect(lowpass);
      lowpass.connect(offline.destination);

      src.start(0);
      const rendered = await offline.startRendering();
      filtered = rendered.getChannelData(0);
    } catch {
      filtered = samples;
    }
  }

  // Smooth sample-by-sample noise gate envelope
  const out = new Float32Array(filtered.length);
  const windowSamples = Math.max(1, Math.floor(0.02 * sampleRate)); // 20ms RMS
  const holdSamples = Math.floor(0.15 * sampleRate); // 150ms hold
  let envRms = 0;
  let holdCounter = 0;
  let currentGain = 1;
  const rmsAlpha = 1 - Math.exp(-1 / windowSamples);
  const attackAlpha = 1 - Math.exp(-1 / Math.max(1, 0.008 * sampleRate));
  const releaseAlpha = 1 - Math.exp(-1 / Math.max(1, 0.045 * sampleRate));

  for (let i = 0; i < filtered.length; i++) {
    const s = filtered[i];
    envRms = Math.sqrt((1 - rmsAlpha) * envRms * envRms + rmsAlpha * s * s);
    let targetGain = preset.gateFloorGain;
    if (envRms >= preset.gateThresholdRms) {
      holdCounter = holdSamples;
      targetGain = 1;
    } else if (holdCounter > 0) {
      holdCounter--;
      targetGain = 1;
    }
    const alpha = targetGain > currentGain ? attackAlpha : releaseAlpha;
    currentGain += alpha * (targetGain - currentGain);
    out[i] = Math.max(-1, Math.min(1, s * currentGain));
  }

  return out;
}
