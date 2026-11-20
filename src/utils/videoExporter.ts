import {
  PRESET_DEFINITIONS,
  type DetectedPause,
  type StyleConfig,
  type SubtitleSegment,
  type TransitionConfig,
  type TransitionPoint,
} from '../types';
import {
  getActivePointTransition,
  getActiveWordChunk,
  type ActiveWordChunk,
} from './subtitles';

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: string;
}

function getPreferredMimeType(): { mimeType: string; extension: string } {
  const candidates = [
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }
  return { mimeType: 'video/webm', extension: 'webm' };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface PillBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function drawSubtitlesOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  chunk: ActiveWordChunk | null,
  currentTime: number,
  style: StyleConfig,
  pillTracker: { chunkId: string; prevWordIdx: number; prevBox: PillBox | null; switchAt: number },
) {
  if (!chunk || chunk.words.length === 0) return;

  const preset = style.preset;
  const presetMeta = PRESET_DEFINITIONS[preset];
  const scaleFactor = Math.max(0.65, width / 720);
  const fontSize = Math.round(presetMeta.baseFontSize * (style.fontScale / 100) * scaleFactor);

  const isUppercase = preset === 'viral_impacto' || preset === 'neon_noturno';
  const fontWeight =
    preset === 'viral_impacto'
      ? '800'
      : preset === 'neon_noturno'
        ? '700'
        : preset === 'elegante_pregacao'
          ? '600'
          : '800';

  const chunkElapsed = Math.max(0, currentTime - chunk.start);
  const activeWord =
    chunk.activeWordIndex >= 0 ? chunk.words[chunk.activeWordIndex] : undefined;
  const wordElapsed = activeWord ? Math.max(0, currentTime - activeWord.start) : 0;

  let globalAlpha = 1;
  let offsetY = 0;

  if (preset === 'viral_impacto') {
    const t = Math.min(1, chunkElapsed / 0.15);
    const eased = 1 - Math.pow(1 - t, 3);
    globalAlpha = eased;
    offsetY = (1 - eased) * 20 * scaleFactor;
  } else if (preset === 'neon_noturno') {
    const t = Math.min(1, chunkElapsed / 0.26);
    const flicker =
      chunkElapsed < 0.22
        ? 0.65 + 0.35 * Math.abs(Math.sin(chunkElapsed * 55))
        : 1;
    globalAlpha = Math.min(1, t * 1.4) * flicker;
  } else if (preset === 'elegante_pregacao') {
    globalAlpha = Math.min(1, chunkElapsed / 0.3);
  }

  ctx.save();
  ctx.globalAlpha = globalAlpha;
  ctx.font = `${fontWeight} ${fontSize}px "${style.fontFamily}", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const words = chunk.words.map((w) => ({
    ...w,
    display: isUppercase ? w.text.toUpperCase() : w.text,
  }));

  const letterSpacing = preset === 'neon_noturno' ? 2 * scaleFactor : 0;
  const measureWord = (txt: string) => {
    const base = ctx.measureText(txt).width;
    return base + Math.max(0, txt.length - 1) * letterSpacing;
  };

  const maxLineWidth = width * 0.84;
  const spaceWidth = ctx.measureText(' ').width + fontSize * 0.14;
  const lines: Array<typeof words> = [];
  let currentLine: typeof words = [];
  let currentLineWidth = 0;

  for (const w of words) {
    const wWidth = measureWord(w.display);
    const addedWidth = currentLine.length === 0 ? wWidth : spaceWidth + wWidth;
    if (currentLine.length > 0 && currentLineWidth + addedWidth > maxLineWidth) {
      lines.push(currentLine);
      currentLine = [w];
      currentLineWidth = wWidth;
    } else {
      currentLine.push(w);
      currentLineWidth += addedWidth;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  const lineHeight = fontSize * 1.32;
  const totalBlockHeight = lines.length * lineHeight;
  const blockCenterY = height * (style.verticalPosition / 100) + offsetY;
  const startY = blockCenterY - totalBlockHeight / 2 + lineHeight / 2;

  // Compute exact word bounding boxes for layout & Style 4 pill
  const wordPositions: Array<{
    word: (typeof words)[number];
    globalIdx: number;
    x: number;
    y: number;
    w: number;
  }> = [];

  let gIdx = 0;
  let widestLine = 0;
  lines.forEach((line, lineIdx) => {
    const lineWidths = line.map((w) => measureWord(w.display));
    const totalLineW =
      lineWidths.reduce((a, b) => a + b, 0) + spaceWidth * Math.max(0, line.length - 1);
    if (totalLineW > widestLine) widestLine = totalLineW;
    let x = width / 2 - totalLineW / 2;
    const y = startY + lineIdx * lineHeight;

    line.forEach((word, wIdx) => {
      const w = lineWidths[wIdx];
      wordPositions.push({ word, globalIdx: gIdx, x, y, w });
      x += w + spaceWidth;
      gIdx++;
    });
  });

  // Style 4: Container rounded box rgba(0,0,0,0.65), radius 16px, padding 12px 20px + sliding gradient pill
  if (preset === 'caixa_destaque') {
    const padX = 20 * scaleFactor;
    const padY = 12 * scaleFactor;
    const radius = 16 * scaleFactor;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    drawRoundedRect(
      ctx,
      width / 2 - widestLine / 2 - padX,
      startY - lineHeight / 2 - padY,
      widestLine + padX * 2,
      totalBlockHeight + padY * 2,
      radius,
    );
    ctx.fill();

    // Sliding pill behind active word (120ms)
    const activeEntry = wordPositions.find((wp) => wp.globalIdx === chunk.activeWordIndex);
    if (activeEntry) {
      const pillPadX = 10 * scaleFactor;
      const pillPadY = 5 * scaleFactor;
      const targetBox: PillBox = {
        x: activeEntry.x - pillPadX,
        y: activeEntry.y - fontSize * 0.56 - pillPadY,
        w: activeEntry.w + pillPadX * 2,
        h: fontSize * 1.12 + pillPadY * 2,
      };

      if (pillTracker.chunkId !== chunk.chunkId) {
        pillTracker.chunkId = chunk.chunkId;
        pillTracker.prevWordIdx = chunk.activeWordIndex;
        pillTracker.prevBox = targetBox;
        pillTracker.switchAt = currentTime;
      } else if (pillTracker.prevWordIdx !== chunk.activeWordIndex) {
        const oldEntry = wordPositions.find((wp) => wp.globalIdx === pillTracker.prevWordIdx);
        pillTracker.prevBox = oldEntry
          ? {
              x: oldEntry.x - pillPadX,
              y: oldEntry.y - fontSize * 0.56 - pillPadY,
              w: oldEntry.w + pillPadX * 2,
              h: fontSize * 1.12 + pillPadY * 2,
            }
          : targetBox;
        pillTracker.prevWordIdx = chunk.activeWordIndex;
        pillTracker.switchAt = currentTime;
      }

      const slideT = Math.min(1, Math.max(0, (currentTime - pillTracker.switchAt) / 0.12));
      const easedSlide = 1 - Math.pow(1 - slideT, 3);
      const fromBox = pillTracker.prevBox ?? targetBox;
      const drawBox: PillBox = {
        x: fromBox.x + (targetBox.x - fromBox.x) * easedSlide,
        y: fromBox.y + (targetBox.y - fromBox.y) * easedSlide,
        w: fromBox.w + (targetBox.w - fromBox.w) * easedSlide,
        h: fromBox.h + (targetBox.h - fromBox.h) * easedSlide,
      };

      const grad = ctx.createLinearGradient(drawBox.x, drawBox.y, drawBox.x + drawBox.w, drawBox.y);
      grad.addColorStop(0, '#8A2BE2');
      grad.addColorStop(1, style.highlightColor || '#FF4D8D');
      ctx.fillStyle = grad;
      drawRoundedRect(ctx, drawBox.x, drawBox.y, drawBox.w, drawBox.h, drawBox.h / 2);
      ctx.fill();
    }
  }

  // Helper to draw text with optional letter spacing
  const drawTextRun = (txt: string, tx: number, ty: number, strokeIt: boolean) => {
    if (letterSpacing <= 0) {
      if (strokeIt) ctx.strokeText(txt, tx, ty);
      else ctx.fillText(txt, tx, ty);
      return;
    }
    let cx = tx;
    for (const ch of txt) {
      if (strokeIt) ctx.strokeText(ch, cx, ty);
      else ctx.fillText(ch, cx, ty);
      cx += ctx.measureText(ch).width + letterSpacing;
    }
  };

  for (const pos of wordPositions) {
    const isActive = pos.globalIdx === chunk.activeWordIndex;
    ctx.save();

    if (isActive && preset === 'viral_impacto') {
      const popT = Math.min(1, wordElapsed / 0.15);
      const popScale = 1 + 0.2 * Math.sin(popT * Math.PI);
      ctx.translate(pos.x + pos.w / 2, pos.y);
      ctx.scale(popScale, popScale);
      ctx.translate(-(pos.x + pos.w / 2), -pos.y);
    }

    if (preset === 'viral_impacto') {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      // Drop shadow 0 4px 0 #000000
      ctx.fillStyle = '#000000';
      drawTextRun(pos.word.display, pos.x, pos.y + 4 * scaleFactor, false);
      // 6px black outline
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(6, 6 * scaleFactor);
      drawTextRun(pos.word.display, pos.x, pos.y, true);
      ctx.fillStyle = isActive ? style.highlightColor : style.textColor;
      drawTextRun(pos.word.display, pos.x, pos.y, false);
    } else if (preset === 'neon_noturno') {
      const glow = isActive ? style.highlightColor : '#00F0FF';
      ctx.fillStyle = isActive ? style.highlightColor : style.textColor;
      for (const blur of [40, 20, 8]) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = blur * scaleFactor;
        drawTextRun(pos.word.display, pos.x, pos.y, false);
      }
    } else if (preset === 'elegante_pregacao') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 10 * scaleFactor;
      ctx.shadowOffsetY = 2 * scaleFactor;
      ctx.fillStyle = isActive ? style.highlightColor : style.textColor;
      drawTextRun(pos.word.display, pos.x, pos.y, false);
      if (isActive) {
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = style.highlightColor;
        ctx.lineWidth = Math.max(1.5, 2 * scaleFactor);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y + fontSize * 0.52);
        ctx.lineTo(pos.x + pos.w, pos.y + fontSize * 0.52);
        ctx.stroke();
      }
    } else {
      // caixa_destaque
      ctx.fillStyle = '#FFFFFF';
      drawTextRun(pos.word.display, pos.x, pos.y, false);
    }

    ctx.restore();
  }

  ctx.restore();
}

function drawVideoWithTransition(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  transition: TransitionConfig,
  transitionPoints: TransitionPoint[],
  currentTime: number,
) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const { activePoint, progress } = getActivePointTransition(
    currentTime,
    transitionPoints,
    transition.enabled && transition.mode === 'transition',
  );

  if (!activePoint) {
    ctx.drawImage(video, 0, 0, width, height);
    return;
  }

  const mult =
    activePoint.intensity === 'low' ? 0.6 : activePoint.intensity === 'high' ? 1.45 : 1.0;

  const p = Math.min(1, Math.max(0, progress));
  const pulse = Math.sin(p * Math.PI);

  ctx.save();
  switch (activePoint.type) {
    case 'fade': {
      const minAlpha = Math.max(0.12, 1 - 0.78 * mult);
      ctx.globalAlpha = 1 - pulse * (1 - minAlpha);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'zoom': {
      const zoomAmount = 1 + 0.16 * mult * pulse;
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoomAmount, zoomAmount);
      ctx.translate(-width / 2, -height / 2);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'slide': {
      const dir = p < 0.5 ? -p * 2 : (1 - p) * 2;
      ctx.translate(dir * width * 0.18 * mult, 0);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'glitch': {
      const jitterX = Math.sin(p * 42) * 14 * mult * pulse;
      const jitterY = Math.cos(p * 34) * 6 * mult * pulse;
      ctx.drawImage(video, jitterX, jitterY, width, height);
      ctx.globalAlpha = 0.35 * pulse;
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(video, -jitterX * 1.4, 0, width, height);
      break;
    }
    case 'whip': {
      const dir = p < 0.5 ? -p * 2 : (1 - p) * 2;
      ctx.filter = `blur(${(6 * mult * pulse).toFixed(1)}px)`;
      ctx.translate(dir * width * 0.42 * mult, 0);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'cube_zoom': {
      const scaleX = Math.max(0.25, Math.abs(Math.cos((p - 0.5) * Math.PI * 0.85)));
      const scaleY = 1 + 0.14 * mult * pulse;
      ctx.translate(width / 2, height / 2);
      ctx.scale(scaleX, scaleY);
      ctx.translate(-width / 2, -height / 2);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'flip': {
      const scaleX = Math.cos(p * Math.PI * 2);
      const scaleY = 1 - 0.14 * pulse;
      ctx.translate(width / 2, height / 2);
      ctx.scale(scaleX, scaleY);
      ctx.translate(-width / 2, -height / 2);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'heartbeat': {
      const beat1 = Math.exp(-Math.pow((p - 0.25) / 0.11, 2));
      const beat2 = Math.exp(-Math.pow((p - 0.62) / 0.13, 2)) * 0.78;
      const scale = 1 + 0.16 * mult * Math.max(beat1, beat2);
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-width / 2, -height / 2);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'flash': {
      ctx.drawImage(video, 0, 0, width, height);
      const flashAlpha = Math.min(0.92, 0.78 * mult * Math.pow(pulse, 1.4));
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'spin': {
      const scale = 1 - 0.22 * pulse;
      ctx.translate(width / 2, height / 2);
      ctx.rotate(p * Math.PI * 2);
      ctx.scale(scale, scale);
      ctx.translate(-width / 2, -height / 2);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'shake': {
      const sx = Math.sin(p * 55) * 12 * mult * pulse;
      const sy = Math.cos(p * 47) * 9 * mult * pulse;
      const rot = (Math.sin(p * 38) * 3.5 * mult * pulse * Math.PI) / 180;
      ctx.translate(width / 2 + sx, height / 2 + sy);
      ctx.rotate(rot);
      ctx.scale(1 + 0.06 * pulse, 1 + 0.06 * pulse);
      ctx.translate(-width / 2, -height / 2);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'blur': {
      ctx.filter = `blur(${(10 * mult * pulse).toFixed(1)}px)`;
      ctx.globalAlpha = Math.max(0.45, 1 - 0.35 * pulse);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'wipe': {
      const ratio = p < 0.5 ? p * 2 : (1 - p) * 2;
      const cropW = Math.max(width * 0.15, width * (1 - ratio * 0.85 * mult));
      ctx.beginPath();
      ctx.rect(0, 0, cropW, height);
      ctx.clip();
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
    case 'bounce': {
      const bounceWave = Math.abs(Math.sin(p * Math.PI * 2.5)) * (1 - p);
      const ty = -height * 0.04 * mult * bounceWave;
      const scale = 1 + 0.1 * mult * bounceWave;
      ctx.translate(width / 2, height / 2 + ty);
      ctx.scale(scale, scale);
      ctx.translate(-width / 2, -height / 2);
      ctx.drawImage(video, 0, 0, width, height);
      break;
    }
  }
  ctx.restore();
}

export async function exportVideoWithBurnedSubtitles(params: {
  videoUrl: string;
  segments: SubtitleSegment[];
  style: StyleConfig;
  transition: TransitionConfig;
  transitionPoints: TransitionPoint[];
  pauses: DetectedPause[];
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const {
    videoUrl,
    segments,
    style,
    transition,
    transitionPoints,
    pauses,
    onProgress,
    signal,
  } = params;

  const video = document.createElement('video');
  video.src = videoUrl;
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Não foi possível carregar o vídeo para renderização.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
  });

  const maxDim = 1080;
  const rawW = video.videoWidth || 720;
  const rawH = video.videoHeight || 1280;
  const scale = Math.min(1, maxDim / Math.max(rawW, rawH));
  const width = Math.round((rawW * scale) / 2) * 2;
  const height = Math.round((rawH * scale) / 2) * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Contexto gráfico 2D não disponível neste navegador.');
  }

  const canvasStream = canvas.captureStream(30);
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const sourceNode = audioCtx.createMediaElementSource(video);
  const destNode = audioCtx.createMediaStreamDestination();
  sourceNode.connect(destNode);

  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destNode.stream.getAudioTracks(),
  ]);

  const { mimeType, extension } = getPreferredMimeType();
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 4_500_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const duration = Math.max(0.1, video.duration || 1);
  let rafId = 0;
  let aborted = false;

  const handleAbort = () => {
    aborted = true;
    video.pause();
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    cancelAnimationFrame(rafId);
  };
  signal?.addEventListener('abort', handleAbort);

  return new Promise<ExportResult>((resolve, reject) => {
    recorder.onstop = () => {
      signal?.removeEventListener('abort', handleAbort);
      cancelAnimationFrame(rafId);
      audioCtx.close().catch(() => {});
      video.src = '';
      if (aborted) {
        reject(new Error('EXPORT_ABORTED'));
        return;
      }
      onProgress(100);
      resolve({
        blob: new Blob(chunks, { type: mimeType }),
        mimeType,
        extension,
      });
    };

    recorder.onerror = () => {
      signal?.removeEventListener('abort', handleAbort);
      cancelAnimationFrame(rafId);
      audioCtx.close().catch(() => {});
      reject(new Error('Erro durante a gravação do vídeo exportado.'));
    };

    const pillTracker = {
      chunkId: '',
      prevWordIdx: -1,
      prevBox: null as PillBox | null,
      switchAt: 0,
    };

    const renderLoop = () => {
      if (aborted) return;

      // Auto-cut long pauses if mode === 'cut'
      if (transition.enabled && transition.mode === 'cut' && pauses.length > 0) {
        for (const p of pauses) {
          if (video.currentTime > p.start + 0.08 && video.currentTime < p.end - 0.08) {
            video.currentTime = p.end;
            break;
          }
        }
      }

      const t = video.currentTime;
      drawVideoWithTransition(ctx, video, width, height, transition, transitionPoints, t);

      const activeChunk = getActiveWordChunk(segments, t);
      drawSubtitlesOnCanvas(ctx, width, height, activeChunk, t, style, pillTracker);

      const pct = Math.min(99, Math.round((t / duration) * 100));
      onProgress(pct);

      if (!video.paused && !video.ended) {
        rafId = requestAnimationFrame(renderLoop);
      }
    };

    video.onended = () => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    };

    Promise.resolve(document.fonts?.ready).finally(() => {
      video.currentTime = 0;
      recorder.start(250);
      audioCtx
        .resume()
        .then(() => video.play())
        .then(() => {
          rafId = requestAnimationFrame(renderLoop);
        })
        .catch((err) => {
          if (recorder.state !== 'inactive') recorder.stop();
          reject(err);
        });
    });
  });
}
