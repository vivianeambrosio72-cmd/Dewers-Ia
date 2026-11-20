import React, { useEffect, useRef, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { motion } from 'motion/react';
import { AlertCircle, ArrowLeft, Loader2, Phone, RefreshCw } from 'lucide-react';
import {
  clearRecaptchaVerifier,
  extractFirebaseErrorCode,
  mapAuthErrorToPortuguese,
  recordLastFirebaseError,
  sendPhoneVerificationCode,
  signInWithGoogle,
} from '../firebase';
import { DemoVideoPreview } from './DemoVideoPreview';
import { PWAInstallButton } from './PWABanners';

interface CountryOption {
  code: string;
  dial: string;
  label: string;
}

const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'AO', dial: '+244', label: 'Angola (+244)' },
  { code: 'BR', dial: '+55', label: 'Brasil (+55)' },
  { code: 'PT', dial: '+351', label: 'Portugal (+351)' },
  { code: 'MZ', dial: '+258', label: 'Moçambique (+258)' },
  { code: 'CV', dial: '+238', label: 'Cabo Verde (+238)' },
  { code: 'ST', dial: '+239', label: 'São Tomé e Príncipe (+239)' },
  { code: 'GW', dial: '+245', label: 'Guiné-Bissau (+245)' },
  { code: 'US', dial: '+1', label: 'Estados Unidos (+1)' },
  { code: 'FR', dial: '+33', label: 'França (+33)' },
  { code: 'ES', dial: '+34', label: 'Espanha (+34)' },
  { code: 'GB', dial: '+44', label: 'Reino Unido (+44)' },
];

const RECAPTCHA_CONTAINER_ID = 'dewes-recaptcha-container';

interface NormalizedPhoneResult {
  dial: string;
  localDigits: string;
  e164: string;
}

export function normalizePhoneInput(
  rawValue: string,
  selectedDial: string,
): NormalizedPhoneResult {
  const trimmed = rawValue.trim();
  const hasPlusPrefix = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  let effectiveDial = selectedDial;
  const selectedDialDigits = selectedDial.replace('+', '');

  if (hasPlusPrefix) {
    const byLongestDial = [...COUNTRY_OPTIONS].sort(
      (a, b) => b.dial.length - a.dial.length,
    );
    const matched = byLongestDial.find((c) =>
      digits.startsWith(c.dial.replace('+', '')),
    );
    if (matched) {
      effectiveDial = matched.dial;
      digits = digits.slice(matched.dial.replace('+', '').length);
    }
  } else if (
    digits.startsWith(selectedDialDigits) &&
    digits.length >= selectedDialDigits.length + 7
  ) {
    digits = digits.slice(selectedDialDigits.length);
  }

  // Strip any leading zeros on local part
  const localDigits = digits.replace(/^0+/, '');

  return {
    dial: effectiveDial,
    localDigits,
    e164: `${effectiveDial}${localDigits}`,
  };
}

function validateNormalizedPhone(
  normalized: NormalizedPhoneResult,
): string | null {
  if (normalized.dial === '+244') {
    if (!/^9\d{8}$/.test(normalized.localDigits)) {
      return 'Número inválido. Digite 9 dígitos, ex.: 9XX XXX XXX';
    }
    return null;
  }

  if (normalized.localDigits.length < 7 || normalized.localDigits.length > 13) {
    return 'Número inválido. Confira e tente de novo.';
  }

  return null;
}

interface LoginScreenProps {
  onLoginSuccess?: () => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [googleLoading, setGoogleLoading] = useState(false);

  // Phone Auth state
  const [dialCode, setDialCode] = useState('+244');
  const [localPhone, setLocalPhone] = useState('');
  const [sentPhoneE164, setSentPhoneE164] = useState('');
  const [smsStage, setSmsStage] = useState<'phone' | 'otp'>('phone');
  const [confirmationResult, setConfirmationResult] =
    useState<ConfirmationResult | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [sendingSms, setSendingSms] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const sendInFlightRef = useRef(false);
  const verifyInFlightRef = useRef(false);

  useEffect(() => {
    const containerEl = recaptchaContainerRef.current;
    return () => {
      clearRecaptchaVerifier(containerEl);
    };
  }, []);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = window.setInterval(() => {
      setResendTimer((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendTimer]);

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
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

  const handlePhoneInputChange = (raw: string) => {
    // Strip characters outside digits, spaces, dashes, parentheses, plus
    const cleanedDisplay = raw.replace(/[^\d\s()+-]/g, '');
    setLocalPhone(cleanedDisplay);
    if (errorMsg) setErrorMsg(null);
  };

  const handlePhonePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (!pastedText) return;
    const normalized = normalizePhoneInput(pastedText, dialCode);
    if (normalized.localDigits.length > 0) {
      e.preventDefault();
      setDialCode(normalized.dial);
      setLocalPhone(normalized.localDigits);
      if (errorMsg) setErrorMsg(null);
    }
  };

  const handleSendCode = async (e?: React.FormEvent, isResend = false) => {
    e?.preventDefault();
    if (sendInFlightRef.current) return;

    setErrorMsg(null);

    const target = isResend && sentPhoneE164
      ? normalizePhoneInput(sentPhoneE164, dialCode)
      : normalizePhoneInput(localPhone, dialCode);

    const validationError = validateNormalizedPhone(target);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    // Reflect normalized local number & country selector cleanly
    setDialCode(target.dial);
    setLocalPhone(target.localDigits);

    sendInFlightRef.current = true;
    setSendingSms(true);
    try {
      const containerTarget =
        recaptchaContainerRef.current ?? RECAPTCHA_CONTAINER_ID;
      const result = await sendPhoneVerificationCode(
        target.e164,
        containerTarget,
        { forceFreshRecaptcha: isResend },
      );
      setConfirmationResult(result);
      setSentPhoneE164(target.e164);
      setSmsStage('otp');
      setOtpDigits(['', '', '', '', '', '']);
      setResendTimer(60);
      window.setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 60);
    } catch (err) {
      recordLastFirebaseError(err, isResend ? 'phone-resend' : 'phone-send');
      const msg = mapAuthErrorToPortuguese(err);
      setErrorMsg(msg || 'Não foi possível enviar o código SMS.');
    } finally {
      sendInFlightRef.current = false;
      setSendingSms(false);
    }
  };

  const applyDigitsFromIndex = (startIndex: number, rawDigits: string) => {
    const clean = rawDigits.replace(/\D/g, '');
    if (!clean) {
      setOtpDigits((prev) => {
        const next = [...prev];
        next[startIndex] = '';
        return next;
      });
      return;
    }

    if (clean.length === 1) {
      setOtpDigits((prev) => {
        const next = [...prev];
        next[startIndex] = clean;
        return next;
      });
      if (startIndex < 5) {
        otpInputRefs.current[startIndex + 1]?.focus();
      }
      return;
    }

    // Handles both full-code paste and OS SMS one-time-code autofill
    const targetStart = clean.length >= 6 ? 0 : startIndex;
    setOtpDigits((prev) => {
      const next = [...prev];
      for (let offset = 0; offset < clean.length && targetStart + offset < 6; offset++) {
        next[targetStart + offset] = clean[offset];
      }
      return next;
    });
    const lastIdx = Math.min(5, targetStart + clean.length - 1);
    const nextEmpty = Math.min(5, targetStart + clean.length);
    otpInputRefs.current[lastIdx === 5 ? 5 : nextEmpty]?.focus();
  };

  const handleOtpChange = (index: number, rawValue: string) => {
    if (errorMsg) setErrorMsg(null);
    applyDigitsFromIndex(index, rawValue);
  };

  const handleOtpKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === 'Backspace') {
      if (otpDigits[index]) {
        e.preventDefault();
        setOtpDigits((prev) => {
          const next = [...prev];
          next[index] = '';
          return next;
        });
      } else if (index > 0) {
        e.preventDefault();
        setOtpDigits((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
        otpInputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (
    index: number,
    e: React.ClipboardEvent<HTMLInputElement>,
  ) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    if (errorMsg) setErrorMsg(null);
    applyDigitsFromIndex(pasted.length >= 6 ? 0 : index, pasted);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyInFlightRef.current) return;

    setErrorMsg(null);
    const code = otpDigits.join('');

    if (code.length < 6) {
      setErrorMsg('Digite os 6 dígitos do código recebido por SMS.');
      return;
    }
    if (!confirmationResult) {
      setErrorMsg('Sessão de verificação expirada. Solicite um novo código.');
      return;
    }

    verifyInFlightRef.current = true;
    setVerifyingOtp(true);
    try {
      await confirmationResult.confirm(code);
      onLoginSuccess?.();
    } catch (err) {
      recordLastFirebaseError(err, 'phone-verify');
      const msg = mapAuthErrorToPortuguese(err);
      setErrorMsg(msg || 'Código incorreto.');
    } finally {
      verifyInFlightRef.current = false;
      setVerifyingOtp(false);
    }
  };

  const handleChangePhoneNumber = () => {
    setSmsStage('phone');
    setConfirmationResult(null);
    setSentPhoneE164('');
    setOtpDigits(['', '', '', '', '', '']);
    setResendTimer(0);
    setErrorMsg(null);
  };

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

          {/* Method 1: Continue with Google (untouched auth logic) */}
          <button
            type="button"
            disabled={googleLoading || sendingSms || verifyingOtp}
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

          {/* Method 2: Phone + SMS Code */}
          {smsStage === 'phone' ? (
            <form onSubmit={(e) => handleSendCode(e, false)} className="space-y-3.5">
              <div className="space-y-1.5">
                <label
                  htmlFor="login-phone-number"
                  className="text-xs font-medium text-slate-300 flex items-center gap-1.5"
                >
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  Entrar com celular (SMS)
                </label>

                <div className="flex gap-2">
                  <select
                    aria-label="Indicativo do país"
                    value={dialCode}
                    disabled={sendingSms}
                    onChange={(e) => setDialCode(e.target.value)}
                    className="w-[140px] shrink-0 h-11 px-2.5 rounded-xl bg-[#0B0D13] border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-purple-400"
                  >
                    {COUNTRY_OPTIONS.map((c) => (
                      <option key={c.code} value={c.dial}>
                        {c.label}
                      </option>
                    ))}
                  </select>

                  <input
                    id="login-phone-number"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    value={localPhone}
                    disabled={sendingSms}
                    onChange={(e) => handlePhoneInputChange(e.target.value)}
                    onPaste={handlePhonePaste}
                    placeholder="936 964 366"
                    className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-[#0B0D13] border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400"
                  />
                </div>
                {dialCode === '+244' && (
                  <p className="text-[11px] text-slate-500">
                    Digite 9 dígitos começando com 9 (ex.: 9XX XXX XXX).
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={sendingSms || googleLoading}
                className="w-full h-11 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, #8A2BE2 0%, #FF4D8D 100%)',
                }}
              >
                {sendingSms && <Loader2 className="w-4 h-4 animate-spin" />}
                {sendingSms ? 'Enviando código...' : 'Enviar código'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-300">
                  Código enviado para{' '}
                  <strong className="text-white">{sentPhoneE164}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleChangePhoneNumber}
                  className="inline-flex items-center gap-1 text-purple-300 hover:text-purple-200 font-medium shrink-0"
                >
                  <ArrowLeft className="w-3 h-3" />
                  Alterar número
                </button>
              </div>

              {/* 6 Separate OTP Inputs with SMS autofill & paste support */}
              <div
                className="grid grid-cols-6 gap-2"
                aria-label="Código de verificação de 6 dígitos"
              >
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      otpInputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                    value={digit}
                    disabled={verifyingOtp}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    onPaste={(e) => handleOtpPaste(idx, e)}
                    aria-label={`Dígito ${idx + 1}`}
                    className="h-12 rounded-xl bg-[#0B0D13] border border-white/15 text-center text-lg font-bold text-white focus:outline-none focus:border-purple-400 transition-colors"
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={verifyingOtp || otpDigits.join('').length < 6}
                className="w-full h-11 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, #8A2BE2 0%, #FF4D8D 100%)',
                }}
              >
                {verifyingOtp && <Loader2 className="w-4 h-4 animate-spin" />}
                {verifyingOtp ? 'Verificando...' : 'Verificar e entrar'}
              </button>

              {/* 60-second Resend Countdown */}
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  disabled={resendTimer > 0 || sendingSms}
                  onClick={() => handleSendCode(undefined, true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  {resendTimer > 0
                    ? `Reenviar código em ${resendTimer}s`
                    : sendingSms
                      ? 'Reenviando...'
                      : 'Reenviar código'}
                </button>
              </div>
            </form>
          )}

          {/* Fixed single invisible reCAPTCHA mount point kept alive across stages */}
          <div ref={recaptchaContainerRef} id={RECAPTCHA_CONTAINER_ID} />

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
