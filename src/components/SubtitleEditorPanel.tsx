import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Languages,
  Link2,
  Play,
  Plus,
  Redo2,
  ReplaceAll,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { SubtitleSegment, SupportedLanguage } from '../types';
import { LANGUAGE_OPTIONS } from '../types';
import {
  formatTimeDisplay,
  formatTimePrecise,
  getReviewWordsList,
} from '../utils/subtitles';

interface SubtitleEditorPanelProps {
  hasVideo: boolean;
  duration: number;
  language: SupportedLanguage;
  customDictionary: string;
  segments: SubtitleSegment[];
  currentTime: number;
  isPlaying: boolean;
  isTranscribing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  subtitlesReviewed: boolean;
  onLanguageChange: (lang: SupportedLanguage) => void;
  onCustomDictionaryChange: (value: string) => void;
  onGenerateSubtitles: () => void;
  onBeginTextEditSnapshot: () => void;
  onEditSegmentText: (segmentId: string, newText: string) => void;
  onEditSingleWord: (segmentId: string, wordId: string, newWordText: string) => void;
  onMarkWordReviewed: (segmentId: string, wordId: string) => void;
  onSplitSegment: (segmentId: string, cursorPos?: number) => void;
  onMergeWithNext: (segmentId: string) => void;
  onDeleteSegment: (segmentId: string) => void;
  onAddSegmentAtCurrentTime: () => void;
  onUpdateSegmentTimes: (segmentId: string, newStart: number, newEnd: number) => void;
  onFindAndReplaceAll: (searchQuery: string, replacement: string) => number;
  onUndo: () => void;
  onRedo: () => void;
  onPlaySegmentClip: (segment: SubtitleSegment) => void;
  onSeekTo: (time: number) => void;
  onConfirmReviewed: () => void;
}

export function SubtitleEditorPanel({
  hasVideo,
  duration,
  language,
  customDictionary,
  segments,
  currentTime,
  isPlaying,
  isTranscribing,
  canUndo,
  canRedo,
  subtitlesReviewed,
  onLanguageChange,
  onCustomDictionaryChange,
  onGenerateSubtitles,
  onBeginTextEditSnapshot,
  onEditSegmentText,
  onEditSingleWord,
  onMarkWordReviewed,
  onSplitSegment,
  onMergeWithNext,
  onDeleteSegment,
  onAddSegmentAtCurrentTime,
  onUpdateSegmentTimes,
  onFindAndReplaceAll,
  onUndo,
  onRedo,
  onPlaySegmentClip,
  onSeekTo,
  onConfirmReviewed,
}: SubtitleEditorPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [replaceFeedback, setReplaceFeedback] = useState<string | null>(null);
  const [editingWord, setEditingWord] = useState<{
    segmentId: string;
    wordId: string;
    draft: string;
  } | null>(null);
  const [activeReviewIdx, setActiveReviewIdx] = useState(0);
  const [focusedRow, setFocusedRow] = useState<{ id: string; text: string } | null>(
    null,
  );

  const listContainerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const totalWords = useMemo(
    () => segments.reduce((acc, s) => acc + s.words.length, 0),
    [segments],
  );
  const activeLanguageLabel =
    LANGUAGE_OPTIONS.find((opt) => opt.value === language)?.label ?? language;

  const reviewWords = useMemo(() => getReviewWordsList(segments), [segments]);

  useEffect(() => {
    if (reviewWords.length === 0) {
      setActiveReviewIdx(0);
    } else if (activeReviewIdx >= reviewWords.length) {
      setActiveReviewIdx(reviewWords.length - 1);
    }
  }, [reviewWords.length, activeReviewIdx]);

  const activeSegmentId = useMemo(() => {
    const found = segments.find(
      (seg) => currentTime >= seg.start && currentTime <= seg.end + 0.05,
    );
    return found?.id ?? null;
  }, [segments, currentTime]);

  // Auto-scroll active line into view while the video plays
  useEffect(() => {
    if (!isPlaying || !activeSegmentId) return;
    const rowEl = rowRefs.current[activeSegmentId];
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isPlaying, activeSegmentId]);

  const searchMatchCount = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return 0;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    return segments.reduce(
      (sum, seg) => sum + (seg.text.match(regex)?.length ?? 0),
      0,
    );
  }, [segments, searchQuery]);

  const handleJumpReview = (direction: 'prev' | 'next') => {
    if (reviewWords.length === 0) return;
    const nextIdx =
      direction === 'next'
        ? (activeReviewIdx + 1) % reviewWords.length
        : (activeReviewIdx - 1 + reviewWords.length) % reviewWords.length;
    setActiveReviewIdx(nextIdx);
    const target = reviewWords[nextIdx];
    if (target) {
      onSeekTo(target.start);
      const rowEl = rowRefs.current[target.segmentId];
      if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setEditingWord({
        segmentId: target.segmentId,
        wordId: target.wordId,
        draft: target.text,
      });
    }
  };

  const handleReplaceAllClick = () => {
    if (!searchQuery.trim()) return;
    const count = onFindAndReplaceAll(searchQuery, replaceText);
    if (count > 0) {
      setReplaceFeedback(`${count} ocorrência(s) substituída(s).`);
      setTimeout(() => setReplaceFeedback(null), 3000);
    } else {
      setReplaceFeedback('Nenhuma ocorrência encontrada.');
      setTimeout(() => setReplaceFeedback(null), 2500);
    }
  };

  const commitWordEdit = () => {
    if (!editingWord) return;
    onEditSingleWord(editingWord.segmentId, editingWord.wordId, editingWord.draft);
    setEditingWord(null);
  };

  const currentReviewTarget =
    reviewWords.length > 0 ? reviewWords[activeReviewIdx] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Generation + Custom Dictionary Card */}
      <div className="p-4 rounded-xl bg-[#11141D] border border-white/10 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
            <label
              htmlFor="subtitle-language"
              className="text-xs font-medium text-slate-300 flex items-center gap-1.5"
            >
              <Languages className="w-3.5 h-3.5 text-slate-400" />
              Idioma da transcrição
            </label>
            <select
              id="subtitle-language"
              value={language}
              disabled={isTranscribing}
              onChange={(e) => onLanguageChange(e.target.value as SupportedLanguage)}
              className="w-full px-3 py-2 rounded-lg bg-[#181C27] border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-amber-400 disabled:opacity-50"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={!hasVideo || isTranscribing}
            onClick={onGenerateSubtitles}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-amber-400 text-slate-950 text-sm font-semibold hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            {isTranscribing
              ? 'Gerando legendas...'
              : segments.length > 0
                ? 'Regerar legendas'
                : 'Gerar legendas'}
          </button>
        </div>

        {/* Custom Dictionary ("Palavras importantes") */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="custom-dictionary"
            className="text-xs font-medium text-slate-300 flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-amber-400" />
              Palavras importantes (opcional)
            </span>
            <span className="text-[11px] text-slate-500">
              Enviadas ao Gemini na geração
            </span>
          </label>
          <input
            id="custom-dictionary"
            type="text"
            value={customDictionary}
            disabled={isTranscribing}
            onChange={(e) => onCustomDictionaryChange(e.target.value)}
            placeholder="Ex.: Igreja Evangélica Divino Amor, Aleluia, Provérbios, Dewers..."
            className="w-full px-3 py-2 rounded-lg bg-[#090B10] border border-white/10 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 disabled:opacity-50"
          />
        </div>

        {segments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 pt-0.5">
            <span className="font-mono-tabular">{formatTimeDisplay(duration)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{segments.length} blocos</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{totalWords} palavras</span>
            <span aria-hidden="true">·</span>
            <span>{activeLanguageLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-400/90">Salvo automaticamente</span>
          </div>
        )}
      </div>

      {/* Main "Editar Legendas" Studio Panel */}
      <div className="rounded-xl bg-[#11141D] border border-white/10 overflow-hidden flex flex-col">
        {/* Header + Undo/Redo + Add */}
        <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Editar Legendas
            </h3>
            <p className="text-[11px] text-slate-400">
              Corrija direto no texto, clique em uma palavra para editar sem perder o tempo ou pressione Enter para dividir.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              title="Desfazer (Ctrl+Z)"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#181C27] border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
              Desfazer
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              title="Refazer (Ctrl+Y)"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#181C27] border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" />
              Refazer
            </button>
            <button
              type="button"
              disabled={!hasVideo}
              onClick={onAddSegmentAtCurrentTime}
              title="Adicionar nova legenda no tempo atual do vídeo"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-400/15 border border-amber-400/40 text-xs font-semibold text-amber-300 hover:bg-amber-400 hover:text-slate-950 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar em {formatTimePrecise(currentTime)}
            </button>
          </div>
        </div>

        {/* Review Alerts Bar + Find & Replace Toolbar */}
        {segments.length > 0 && (
          <div className="px-4 py-3 bg-[#0D1017] border-b border-white/10 space-y-2.5">
            {/* Review Counter & Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                {reviewWords.length > 0 ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="font-semibold text-amber-300">
                      {reviewWords.length}{' '}
                      {reviewWords.length === 1
                        ? 'palavra para revisar'
                        : 'palavras para revisar'}
                    </span>
                    {currentReviewTarget && (
                      <span className="text-slate-400 hidden sm:inline">
                        · Atual: &ldquo;{currentReviewTarget.text}&rdquo;
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-emerald-300 font-medium">
                      Nenhuma palavra marcada para revisão
                    </span>
                  </>
                )}
              </div>

              {reviewWords.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleJumpReview('prev')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#181C27] border border-amber-400/30 text-xs text-amber-200 hover:bg-amber-400/15 transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Anterior
                  </button>
                  <span className="font-mono-tabular text-[11px] text-slate-400 px-1">
                    {activeReviewIdx + 1}/{reviewWords.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleJumpReview('next')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#181C27] border border-amber-400/30 text-xs text-amber-200 hover:bg-amber-400/15 transition-colors"
                  >
                    Próxima
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Find & Replace */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <div className="relative flex-1 min-w-[140px]">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Localizar palavra..."
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-md bg-[#181C27] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="Substituir por..."
                className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-md bg-[#181C27] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />

              <button
                type="button"
                disabled={!searchQuery.trim() || searchMatchCount === 0}
                onClick={handleReplaceAllClick}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181C27] border border-white/15 text-xs font-semibold text-slate-100 hover:border-amber-400 hover:text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                <ReplaceAll className="w-3.5 h-3.5" />
                Substituir em todas
                {searchQuery.trim() ? ` (${searchMatchCount})` : ''}
              </button>

              {replaceFeedback && (
                <span className="text-[11px] text-emerald-400 font-medium">
                  {replaceFeedback}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Subtitles List */}
        {segments.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-300">
              Nenhuma legenda gerada ainda
            </p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              {hasVideo
                ? 'Adicione palavras importantes acima se desejar e clique em "Gerar legendas" para transcrever com o Gemini.'
                : 'Envie um vídeo MP4 ou MOV na Etapa 1 para começar a legendar.'}
            </p>
          </div>
        ) : (
          <div
            ref={listContainerRef}
            className="divide-y divide-white/[0.06] max-h-[500px] overflow-y-auto"
          >
            {segments.map((seg, idx) => {
              const isCurrent = seg.id === activeSegmentId;
              const isSearchMatch =
                searchQuery.trim().length > 0 &&
                seg.text.toLowerCase().includes(searchQuery.trim().toLowerCase());
              const hasNext = idx < segments.length - 1;

              return (
                <div
                  key={seg.id}
                  ref={(el) => {
                    rowRefs.current[seg.id] = el;
                  }}
                  className={`p-3.5 space-y-2.5 transition-colors ${
                    isCurrent
                      ? 'bg-amber-400/[0.09] border-l-2 border-l-amber-400'
                      : isSearchMatch
                        ? 'bg-sky-400/[0.07]'
                        : 'hover:bg-white/[0.02]'
                  }`}
                >
                  {/* Row Header: Play Clip + Start/End Numeric Inputs + Tools */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onPlaySegmentClip(seg)}
                        title="Ouvir somente este trecho no vídeo"
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                          isCurrent && isPlaying
                            ? 'bg-amber-400 text-slate-950 border-amber-400'
                            : 'bg-[#181C27] text-slate-200 border-white/10 hover:border-amber-400/60 hover:text-amber-300'
                        }`}
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Ouvir
                      </button>

                      <div className="flex items-center gap-1 text-[11px] text-slate-400">
                        <label
                          htmlFor={`start-${seg.id}`}
                          className="sr-only"
                        >
                          Tempo de início
                        </label>
                        <input
                          id={`start-${seg.id}`}
                          type="number"
                          step={0.1}
                          min={0}
                          max={Math.max(0, Number((seg.end - 0.15).toFixed(2)))}
                          value={Number(seg.start.toFixed(2))}
                          onFocus={onBeginTextEditSnapshot}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (Number.isFinite(val)) {
                              onUpdateSegmentTimes(seg.id, val, seg.end);
                            }
                          }}
                          className="w-16 px-1.5 py-0.5 rounded bg-[#090B10] border border-white/10 font-mono-tabular text-[11px] text-slate-200 focus:outline-none focus:border-amber-400"
                        />
                        <span>→</span>
                        <label
                          htmlFor={`end-${seg.id}`}
                          className="sr-only"
                        >
                          Tempo de fim
                        </label>
                        <input
                          id={`end-${seg.id}`}
                          type="number"
                          step={0.1}
                          min={Number((seg.start + 0.15).toFixed(2))}
                          max={duration > 0 ? Number(duration.toFixed(2)) : 3600}
                          value={Number(seg.end.toFixed(2))}
                          onFocus={onBeginTextEditSnapshot}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (Number.isFinite(val)) {
                              onUpdateSegmentTimes(seg.id, seg.start, val);
                            }
                          }}
                          className="w-16 px-1.5 py-0.5 rounded bg-[#090B10] border border-white/10 font-mono-tabular text-[11px] text-slate-200 focus:outline-none focus:border-amber-400"
                        />
                        <span className="text-[10px] text-slate-500">s</span>
                      </div>
                    </div>

                    {/* Row Editing Actions: Split, Merge, Delete */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={seg.words.length < 2}
                        onClick={() => onSplitSegment(seg.id)}
                        title="Dividir esta legenda em duas (ou pressione Enter no meio do texto)"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#181C27] border border-white/10 text-[11px] text-slate-300 hover:text-white hover:border-white/25 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                      >
                        <Scissors className="w-3 h-3" />
                        Dividir
                      </button>

                      {hasNext && (
                        <button
                          type="button"
                          onClick={() => onMergeWithNext(seg.id)}
                          title="Juntar com a legenda abaixo"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#181C27] border border-white/10 text-[11px] text-slate-300 hover:text-white hover:border-white/25 transition-colors"
                        >
                          <Link2 className="w-3 h-3" />
                          Juntar
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onDeleteSegment(seg.id)}
                        title="Excluir legenda"
                        aria-label={`Excluir legenda ${idx + 1}`}
                        className="p-1 rounded bg-[#181C27] border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-400/40 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Direct Inline Editable Text Input */}
                  <input
                    type="text"
                    value={focusedRow?.id === seg.id ? focusedRow.text : seg.text}
                    onFocus={() => {
                      if (focusedRow?.id !== seg.id) {
                        setFocusedRow({ id: seg.id, text: seg.text });
                        onBeginTextEditSnapshot();
                      }
                    }}
                    onBlur={() => setFocusedRow(null)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFocusedRow({ id: seg.id, text: val });
                      onEditSegmentText(seg.id, val);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && seg.words.length >= 2) {
                        e.preventDefault();
                        const cursorPos = e.currentTarget.selectionStart ?? Math.floor(seg.text.length / 2);
                        setFocusedRow(null);
                        onSplitSegment(seg.id, cursorPos);
                      }
                    }}
                    aria-label={`Texto da legenda ${idx + 1}`}
                    className="w-full px-3 py-2 rounded-lg bg-[#090B10] border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-amber-400 transition-colors"
                  />

                  {/* Per-Word Individual Editor & Confidence Highlights */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {seg.words.map((word) => {
                      const isEditingThisWord =
                        editingWord?.segmentId === seg.id &&
                        editingWord?.wordId === word.id;
                      const isWordActive =
                        currentTime >= word.start && currentTime <= word.end;
                      const isLowConf = Boolean(word.needsReview);
                      const isReviewTarget =
                        currentReviewTarget?.wordId === word.id;

                      if (isEditingThisWord) {
                        return (
                          <div key={word.id} className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              autoFocus
                              value={editingWord.draft}
                              onChange={(e) =>
                                setEditingWord({
                                  ...editingWord,
                                  draft: e.target.value,
                                })
                              }
                              onBlur={commitWordEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitWordEdit();
                                } else if (e.key === 'Escape') {
                                  setEditingWord(null);
                                }
                              }}
                              style={{
                                width: `${Math.max(5, editingWord.draft.length + 2)}ch`,
                              }}
                              className="px-2 py-0.5 rounded bg-[#05070B] border border-amber-400 text-xs text-white focus:outline-none"
                            />
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                commitWordEdit();
                              }}
                              aria-label="Confirmar palavra"
                              className="p-0.5 rounded bg-amber-400 text-slate-950"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={word.id}
                          className={`inline-flex items-center rounded border text-xs transition-colors ${
                            isLowConf
                              ? isReviewTarget
                                ? 'bg-amber-400/30 border-amber-300 text-amber-100 ring-1 ring-amber-400'
                                : 'bg-amber-400/20 border-amber-400/60 text-amber-200'
                              : isWordActive
                                ? 'bg-sky-400/20 border-sky-400/50 text-sky-200'
                                : 'bg-[#181C27] border-white/10 text-slate-300 hover:border-white/25'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSeekTo(word.start);
                              setEditingWord({
                                segmentId: seg.id,
                                wordId: word.id,
                                draft: word.text,
                              });
                            }}
                            title={`${formatTimePrecise(word.start)}–${formatTimePrecise(word.end)} · Clique para editar esta palavra mantendo o tempo`}
                            className="px-2 py-0.5 text-left"
                          >
                            {word.text}
                          </button>
                          {isLowConf && (
                            <button
                              type="button"
                              onClick={() => onMarkWordReviewed(seg.id, word.id)}
                              title="Marcar palavra como conferida"
                              aria-label={`Confirmar palavra ${word.text}`}
                              className="pr-1.5 pl-0.5 text-amber-300 hover:text-emerald-300"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Required Review Confirmation Gate before Step 3 */}
        {segments.length > 0 && (
          <div className="px-4 py-3.5 bg-[#0D1017] border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs">
              {subtitlesReviewed ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  Legendas revisadas e confirmadas! Clique em &ldquo;Continuar&rdquo; para ir às Transições.
                </span>
              ) : (
                <span className="text-slate-300">
                  Revise as palavras e confirme abaixo para liberar a Etapa 3 (onde o texto ficará travado).
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onConfirmReviewed}
              disabled={subtitlesReviewed}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                subtitlesReviewed
                  ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 cursor-default'
                  : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              {subtitlesReviewed ? 'Legendas revisadas ✓' : 'Legendas revisadas'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
