import React from 'react';
import { FolderOpen, LogIn, Trash2 } from 'lucide-react';
import type { SavedProject } from '../types';
import { formatTimeDisplay } from '../utils/subtitles';

interface ProjectsPanelProps {
  isAuthenticated: boolean;
  isLoading: boolean;
  projects: SavedProject[];
  activeProjectId: string | null;
  onSignIn: () => void;
  onOpenProject: (project: SavedProject) => void;
  onDeleteProject: (projectId: string) => void;
  onBackToEditor: () => void;
}

export function ProjectsPanel({
  isAuthenticated,
  isLoading,
  projects,
  activeProjectId,
  onSignIn,
  onOpenProject,
  onDeleteProject,
  onBackToEditor,
}: ProjectsPanelProps) {
  if (!isAuthenticated) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 rounded-xl bg-[#11141D] border border-white/10 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center mx-auto text-amber-400">
          <FolderOpen className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-semibold text-slate-100">
          Salve e sincronize seus projetos
        </h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          Entre com sua conta Google para guardar suas legendas editadas, estilos personalizados e configurações de transição na nuvem.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-400 text-slate-950 text-sm font-semibold hover:bg-amber-300 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            Entrar com Google
          </button>
          <button
            type="button"
            onClick={onBackToEditor}
            className="px-4 py-2.5 rounded-lg bg-[#181C27] border border-white/10 text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors"
          >
            Voltar ao editor
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Meus projetos</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Projetos salvos na sua conta. Ao abrir um projeto salvo, você pode baixar o .SRT ou reenviar o vídeo local para exportar.
          </p>
        </div>
        <button
          type="button"
          onClick={onBackToEditor}
          className="px-4 py-2 rounded-lg bg-[#181C27] border border-white/10 text-xs font-semibold text-slate-100 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
        >
          Voltar ao editor
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="h-28 rounded-xl bg-[#11141D] border border-white/10 animate-pulse"
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="p-10 rounded-xl bg-[#11141D] border border-white/10 text-center space-y-3">
          <p className="text-sm font-medium text-slate-200">
            Você ainda não salvou nenhum projeto
          </p>
          <p className="text-xs text-slate-500">
            Gere legendas no editor e clique em "Salvar projeto" para mantê-las disponíveis aqui.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((proj) => {
            const isActive = proj.id === activeProjectId;
            return (
              <div
                key={proj.id}
                className={`p-4 rounded-xl bg-[#11141D] border transition-colors flex flex-col justify-between gap-4 ${
                  isActive ? 'border-amber-400/60' : 'border-white/10'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-100 truncate">
                      {proj.title}
                    </h3>
                    <button
                      type="button"
                      onClick={() => onDeleteProject(proj.id)}
                      aria-label={`Excluir projeto ${proj.title}`}
                      className="text-slate-500 hover:text-rose-400 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="truncate max-w-[180px]">{proj.videoFileName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{formatTimeDisplay(proj.duration)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{proj.wordCount} palavras</span>
                    <span aria-hidden="true">·</span>
                    <span>{proj.language}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                  <span className="text-xs text-slate-500">
                    Estilo: {proj.styleConfig.preset}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenProject(proj)}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-semibold hover:bg-amber-300 transition-colors whitespace-nowrap"
                  >
                    Abrir no editor
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
