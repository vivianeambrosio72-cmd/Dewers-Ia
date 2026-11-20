import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Ocorreu um erro inesperado na interface.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#090B10] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#11141D] border border-white/10 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-base font-semibold text-slate-100">
                Algo deu errado no Dewers IA
              </h2>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-400 text-slate-950 text-sm font-semibold hover:bg-amber-300 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Recarregar estúdio
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
