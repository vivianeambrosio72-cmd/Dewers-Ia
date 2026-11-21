import {
  PRESET_DEFINITIONS,
  type StyleConfig,
  type SubtitleSegment,
} from '../types';
import { getActiveWordChunk, type ActiveWordChunk } from './subtitles';

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

  const isUppercase =
    preset === 'viral_impacto' ||
    preset === 'neon_noturno' ||
    preset === 'mrbeast_3d' ||
    preset === 'cyber_glitch' ||
    preset === 'fogo_turbo';

  const fontWeight =
    preset === 'mrbeast_3d'
      ? '900'
      : preset === 'viral_impacto' || preset === 'caixa_destaque' || preset === 'cinema_blur'
        ? '800'
        : preset === 'neon_noturno' || preset === 'cyber_glitch' || preset === 'fogo_turbo'
          ? '700'
          : '600';

  const chunkElapsed = Math.max(0, currentTime - chunk.start);
  const activeWord =
    chunk.activeWordIndex >= 0 ? chunk.words[chunk.activeWordIndex] : undefined;
  const wordElapsed = activeWord ? Math.max(0, currentTime - activeWord.start) : 0;

  let globalAlpha = 1;
  let offsetY = 0;

  if (preset === 'viral_impacto' || preset === 'mrbeast_3d' || preset === 'fogo_turbo') {
    const t = Math.min(1, chunkElapsed / 0.14);
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
  } else if (preset === 'elegante_pregacao' || preset === 'cinema_blur') {
    globalAlpha = Math.min(1, chunkElapsed / 0.26);
  } else if (preset === 'cyber_glitch') {
    globalAlpha = Math.min(1, chunkElapsed / 0.12);
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

  const letterSpacing =
    preset === 'neon_noturno'
      ? 2 * scaleFactor
      : preset === 'cyber_glitch' || preset === 'fogo_turbo'
        ? 1.2 * scaleFactor
        : 0;
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

  // Compute exact word bounding boxes for layout & pill/backdrop effects
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

  // Cinema Blur frosted dark bar backdrop
  if (preset === 'cinema_blur') {
    const padX = 22 * scaleFactor;
    const padY = 12 * scaleFactor;
    const radius = 14 * scaleFactor;
    const bx = width / 2 - widestLine / 2 - padX;
    const by = startY - lineHeight / 2 - padY;
    const bw = widestLine + padX * 2;
    const bh = totalBlockHeight + padY * 2;
    ctx.fillStyle = 'rgba(9, 11, 16, 0.68)';
    drawRoundedRect(ctx, bx, by, bw, bh, radius);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = Math.max(1, scaleFactor);
    ctx.stroke();
  }

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

    const cx = pos.x + pos.w / 2;
    const cy = pos.y;

    if (isActive && preset === 'viral_impacto') {
      const popT = Math.min(1, wordElapsed / 0.15);
      const popScale = 1 + 0.2 * Math.sin(popT * Math.PI);
      ctx.translate(cx, cy);
      ctx.scale(popScale, popScale);
      ctx.translate(-cx, -cy);
    } else if (preset === 'mrbeast_3d') {
      const popT = isActive ? Math.min(1, wordElapsed / 0.16) : 0;
      const popScale = isActive ? 1.06 + 0.18 * Math.sin(popT * Math.PI) : 1;
      ctx.translate(cx, cy);
      ctx.transform(1, 0, -0.12, 1, 0, 0);
      ctx.scale(popScale, popScale);
      ctx.translate(-cx, -cy);
    } else if (isActive && preset === 'cyber_glitch') {
      const p = Math.min(1, wordElapsed / 0.12);
      const jitterX = p < 1 ? Math.sin(wordElapsed * 140) * 3 * scaleFactor * (1 - p) : 0;
      ctx.translate(cx + jitterX, cy);
      ctx.transform(1, 0, -0.14, 1, 0, 0);
      ctx.scale(1.06, 1.06);
      ctx.translate(-cx, -cy);
    } else if (isActive && preset === 'fogo_turbo') {
      const popT = Math.min(1, wordElapsed / 0.16);
      const popScale = 1.04 + 0.16 * Math.sin(popT * Math.PI);
      ctx.translate(cx, cy);
      ctx.scale(popScale, popScale);
      ctx.translate(-cx, -cy);
    } else if (isActive && preset === 'cinema_blur') {
      ctx.translate(cx, cy);
      ctx.scale(1.09, 1.09);
      ctx.translate(-cx, -cy);
    }

    if (preset === 'viral_impacto') {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.fillStyle = '#000000';
      drawTextRun(pos.word.display, pos.x, pos.y + 4 * scaleFactor, false);
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
    } else if (preset === 'mrbeast_3d') {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.fillStyle = '#000000';
      for (const step of [6, 4, 2]) {
        drawTextRun(pos.word.display, pos.x, pos.y + step * scaleFactor, false);
      }
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(6, 7 * scaleFactor);
      drawTextRun(pos.word.display, pos.x, pos.y, true);
      ctx.fillStyle = isActive ? style.highlightColor : style.textColor;
      drawTextRun(pos.word.display, pos.x, pos.y, false);
    } else if (preset === 'cyber_glitch') {
      const accent = style.highlightColor || '#00F0FF';
      if (isActive) {
        const padX = fontSize * 0.24;
        const padY = fontSize * 0.14;
        const bx = pos.x - padX;
        const by = pos.y - fontSize * 0.54 - padY;
        const bw = pos.w + padX * 2;
        const bh = fontSize * 1.08 + padY * 2;
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 16 * scaleFactor;
        ctx.fillStyle = accent;
        drawRoundedRect(ctx, bx, by, bw, bh, 5 * scaleFactor);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#05070B';
        drawTextRun(pos.word.display, pos.x, pos.y, false);
      } else {
        ctx.fillStyle = '#00F0FF';
        drawTextRun(pos.word.display, pos.x - 3 * scaleFactor, pos.y, false);
        ctx.fillStyle = '#FF0055';
        drawTextRun(pos.word.display, pos.x + 3 * scaleFactor, pos.y, false);
        ctx.fillStyle = style.textColor;
        drawTextRun(pos.word.display, pos.x, pos.y, false);
      }
    } else if (preset === 'fogo_turbo') {
      const fireAccent = style.highlightColor || '#FF7A00';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      if (isActive) {
        ctx.shadowColor = fireAccent;
        ctx.shadowBlur = 18 * scaleFactor;
      }
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(5, 5.5 * scaleFactor);
      drawTextRun(pos.word.display, pos.x, pos.y, true);
      if (isActive) {
        const grad = ctx.createLinearGradient(
          pos.x,
          pos.y - fontSize * 0.5,
          pos.x,
          pos.y + fontSize * 0.5,
        );
        grad.addColorStop(0, '#FFFFFF');
        grad.addColorStop(0.45, '#FFE600');
        grad.addColorStop(1, fireAccent);
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = style.textColor;
      }
      drawTextRun(pos.word.display, pos.x, pos.y, false);
    } else if (preset === 'cinema_blur') {
      const gold = style.highlightColor || '#FFB800';
      if (isActive) {
        ctx.filter = 'none';
        ctx.globalAlpha = globalAlpha;
        ctx.shadowColor = gold;
        ctx.shadowBlur = 16 * scaleFactor;
        ctx.fillStyle = gold;
      } else {
        ctx.filter = `blur(${(1.2 * scaleFactor).toFixed(1)}px)`;
        ctx.globalAlpha = globalAlpha * 0.48;
        ctx.fillStyle = style.textColor;
      }
      drawTextRun(pos.word.display, pos.x, pos.y, false);
    } else {
      // caixa_destaque
      ctx.fillStyle = '#FFFFFF';
      drawTextRun(pos.word.display, pos.x, pos.y, false);
    }

    ctx.restore();
  }

  ctx.restore();
}

export async function exportVideoWithBurnedSubtitles(params: {
  videoUrl: string;
  segments: SubtitleSegment[];
  style: StyleConfig;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const {
    videoUrl,
    segments,
    style,
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

      const t = video.currentTime;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);

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
