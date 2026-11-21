import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
} from 'lucide-react';
import {
  extractFirebaseErrorCode,
  mapAuthErrorToPortuguese,
  recordLastFirebaseError,
  registerWithEmail,
  resetPasswordWithEmail,
  signInWithEmail,
  signInWithGoogle,
} from '../firebase';
import { DemoVideoPreview } from './DemoVideoPreview';
import { PWAInstallButton } from './PWABanners';

type EmailAuthMode = 'login' | 'register';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface LoginScreenProps {
  onLoginSuccess?: () => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [googleLoading, setGoogleLoading] = useState(false);

  // Email Auth state
  const [mode, setMode] = useState<EmailAuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      onLoginSuccess?.();
    } catch (err) {
      const code = extractFirebaseErrorCode(err);
      if (code !== 'auth/popup-closed-by-user') {
        recordLastFirebaseError(err, 'google-login');
      }
      const msg = mapAuthErrorToPortuguese(err);
      if (msg) setErrorMsg(msg);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSwitchMode = (nextMode: EmailAuthMode) => {
    setMode(nextMode);
    setErrorMsg(null);
    setInfoMsg(null);
    setConfirmPassword('');
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitInFlightRef.current) return;

    setErrorMsg(null);
    setInfoMsg(null);

    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setErrorMsg('Digite um endereço de e-mail válido.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setErrorMsg('As senhas não coincidem. Confira e tente novamente.');
      return;
    }

    submitInFlightRef.current = true;
    setEmailLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(trimmedEmail, password);
      } else {
        await registerWithEmail(trimmedEmail, password);
      }
      onLoginSuccess?.();
    } catch (err) {
      recordLastFirebaseError(
        err,
        mode === 'login' ? 'email-login' : 'email-register',
      );
      const msg = mapAuthErrorToPortuguese(err);
      setErrorMsg(msg || 'Não foi possível entrar com e-mail.');
    } finally {
      submitInFlightRef.current = false;
      setEmailLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (resetLoading || emailLoading) return;
    setErrorMsg(null);
    setInfoMsg(null);

    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setErrorMsg('Digite seu e-mail acima para receber o link de redefinição.');
      return;
    }

    setResetLoading(true);
    try {
      await resetPasswordWithEmail(trimmedEmail);
      setInfoMsg(
        `Enviamos um link para redefinir a senha para ${trimmedEmail}. Confira a caixa de entrada e o spam.`,
      );
    } catch (err) {
      recordLastFirebaseError(err, 'email-reset-password');
      const msg = mapAuthErrorToPortuguese(err);
      setErrorMsg(msg || 'Não foi possível enviar o e-mail de recuperação.');
    } finally {
      setResetLoading(false);
    }
  };

  const busy = googleLoading || emailLoading || resetLoading;

  return (
    <div
      className="min-h-screen bg-[#0B0D13] text-slate-100 grid grid-cols-1 lg:grid-cols-2 relative"
      style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif' }}
    >
      <div className="fixed top-4 right-4 z-30">
        <PWAInstallButton />
      </div>

      {/* Left Column: Centered Dark Login Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="flex flex-col items-center justify-center px-6 py-10 sm:px-10"
      >
        <div className="w-full max-w-[410px] rounded-2xl bg-[#12151F] border border-white/10 p-7 sm:p-8 shadow-2xl">
          {/* Logo DEWES IA */}
          <div className="mb-7">
            <span className="text-xl font-extrabold tracking-tight text-white">
              DEWES{' '}
            </span>
            <span
              className="text-xl font-extrabold tracking-tight bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, #8A2BE2 0%, #FF4D8D 100%)',
              }}
            >
              IA
            </span>
          </div>

          {/* Heading */}
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1.5">
            Bem-vinda ao DEWES IA
          </h1>
          <p className="text-sm text-slate-400 mb-7">
            Legendas automáticas para os seus vídeos
          </p>

          {/* Error Feedback */}
          {errorMsg && (
            <div
              role="alert"
              className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 flex items-start gap-2.5 leading-relaxed"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success / Info Feedback */}
          {infoMsg && (
            <div
              role="status"
              className="mb-5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-2.5 leading-relaxed"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{infoMsg}</span>
            </div>
          )}

          {/* Method 1: Continue with Google (untouched auth logic) */}
          <button
            type="button"
            disabled={busy}
            onClick={handleGoogleLogin}
            className="w-full h-11 px-4 rounded-xl bg-white text-slate-900 border border-white/20 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-3 shadow-sm"
          >
            {googleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
            ) : (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="w-4 h-4 shrink-0"
              >
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
            )}
            <span>Continuar com Google</span>
          </button>

          {/* Divider "ou" */}
          <div className="my-6 flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs font-medium text-slate-500">ou</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Method 2: Email & Password */}
          <div className="mb-4 grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#0B0D13] border border-white/10">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSwitchMode('login')}
              className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSwitchMode('register')}
              className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Criar conta
            </button>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-3.5" noValidate>
            <div className="space-y-1.5">
              <label
                htmlFor="login-email"
                className="text-xs font-medium text-slate-300 flex items-center gap-1.5"
              >
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                E-mail
              </label>
              <input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                disabled={busy}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                  if (infoMsg) setInfoMsg(null);
                }}
                placeholder="seuemail@exemplo.com"
                className="w-full h-11 px-3.5 rounded-xl bg-[#0B0D13] border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="login-password"
                  className="text-xs font-medium text-slate-300 flex items-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  Senha
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handlePasswordReset}
                    className="text-[11px] text-purple-300 hover:text-purple-200 disabled:opacity-50 transition-colors"
                  >
                    {resetLoading ? 'Enviando...' : 'Esqueci minha senha'}
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  disabled={busy}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Mínimo de 6 caracteres"
                  className="w-full h-11 pl-3.5 pr-10 rounded-xl bg-[#0B0D13] border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="login-confirm-password"
                  className="text-xs font-medium text-slate-300 flex items-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  Confirmar senha
                </label>
                <input
                  id="login-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  disabled={busy}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Repita a senha"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0B0D13] border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400 transition-colors"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, #8A2BE2 0%, #FF4D8D 100%)',
              }}
            >
              {emailLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login'
                ? emailLoading
                  ? 'Entrando...'
                  : 'Entrar com e-mail'
                : emailLoading
                  ? 'Criando conta...'
                  : 'Criar conta com e-mail'}
            </button>
          </form>

          {/* Small Legal Footer */}
          <p className="mt-7 text-[11px] text-center text-slate-500 leading-relaxed">
            Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade.
          </p>
        </div>
      </motion.div>

      {/* Right Column (Desktop) / Below Login Card (Mobile): Demo Video Panel */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="flex items-center justify-center px-6 py-10 lg:p-10 bg-[#0E1017] border-t lg:border-t-0 lg:border-l border-white/[0.06]"
      >
        <DemoVideoPreview />
      </motion.div>
    </div>
  );
}
