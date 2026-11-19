import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Gauge, ShieldCheck } from 'lucide-react';
import { apiFetch, initializeCsrfToken } from '../api';

export type AuthMode = 'signin' | 'signup';

interface AuthPageProps {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onBack: () => void;
  onAuthenticated: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  mode,
  onModeChange,
  onBack,
  onAuthenticated,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignUp = mode === 'signup';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get('password') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');

    if (isSignUp && password !== confirmPassword) {
      setError('Those passwords don’t match. Please try again.');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      await initializeCsrfToken();
      const response = await apiFetch(isSignUp ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          password,
          workshopName: formData.get('workshopName'),
        }),
      }, false);
      const result = await response.json() as { error?: unknown };
      if (!response.ok) {
        throw new Error(typeof result.error === 'string' ? result.error : 'Unable to sign in.');
      }
      onAuthenticated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to reach the server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-[#111827]">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[0.95fr_1.05fr]">
        <section className="relative hidden overflow-hidden bg-[#081426] px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
          <div className="absolute -right-36 top-24 h-96 w-96 rounded-full border border-white/[0.07]" />
          <div className="absolute -right-16 top-44 h-72 w-72 rounded-full border border-white/[0.07]" />
          <div className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-[#17365f]/40 blur-3xl" />
          <a href="#" className="relative z-10 flex w-fit items-center gap-2.5" aria-label="NEXTGEN home" onClick={(event) => { event.preventDefault(); onBack(); }}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#39a8ff] text-[#081426]">
              <Gauge className="h-5 w-5" />
            </span>
            <span className="text-xl font-extrabold tracking-[0.12em]">NEXTGEN</span>
          </a>
          <div className="relative z-10 max-w-xl py-14">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#39a8ff]">
              {isSignUp ? 'A better shop starts here' : 'Welcome back to your shop'}
            </p>
            <h1 className="mt-5 text-5xl font-extrabold leading-[1.08] tracking-[-0.05em] xl:text-6xl">
              {isSignUp ? 'Make room for a smoother workday.' : 'Good work starts with a clear view.'}
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-[#c5d3e4]">
              Driving Excellence Through Smart Vehicle Care. Keep customers, vehicles, and service work connected in one place.
            </p>
            <div className="mt-10 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#39a8ff]/10 text-[#39a8ff]">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-bold">Your workshop at a glance</p>
                <p className="mt-1 text-xs text-[#aebed3]">Jobs, vehicles, and progress in one place</p>
              </div>
            </div>
          </div>
          <p className="relative z-10 text-xs font-medium text-[#91a4bd]">NEXTGEN – Vehicle Service and Repair Management System</p>
        </section>

        <section className="flex min-h-screen flex-col px-5 py-6 sm:px-10 lg:px-12 xl:px-20">
          <div className="flex items-center justify-between lg:justify-end">
            <a href="#" className="flex items-center gap-2 lg:hidden" aria-label="NEXTGEN home" onClick={(event) => { event.preventDefault(); onBack(); }}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0b1c34] text-[#39a8ff]">
                <Gauge className="h-4 w-4" />
              </span>
              <span className="font-extrabold tracking-[0.12em]">NEXTGEN</span>
            </a>
            <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#627189] transition hover:text-[#27364b]">
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </button>
          </div>

          <div className="mx-auto my-auto w-full max-w-md py-12">
            <div className="mb-8">
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#1b72c7]">
                {isSignUp ? 'Get started' : 'Welcome back'}
              </p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.045em] text-[#101c30] sm:text-4xl">
                {isSignUp ? 'Create your account' : 'Sign in to NEXTGEN'}
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#66758b]">
                {isSignUp
                  ? 'Create your owner account and get started with the workshop dashboard.'
                  : 'Enter your details to access your workshop dashboard.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {isSignUp && (
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-[#26374e]">Your name</span>
                  <input
                    autoComplete="name"
                    name="name"
                    required
                    type="text"
                    placeholder="Alex Morgan"
                    className="w-full rounded-xl border border-[#dce5ef] bg-white px-4 py-3.5 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10"
                  />
                </label>
              )}
              {isSignUp && (
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-[#26374e]">Workshop name</span>
                  <input
                    autoComplete="organization"
                    name="workshopName"
                    required
                    minLength={2}
                    maxLength={120}
                    type="text"
                    placeholder="Morgan Auto Care"
                    className="w-full rounded-xl border border-[#dce5ef] bg-white px-4 py-3.5 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-[#26374e]">Email address</span>
                <input
                  autoComplete="email"
                  name="email"
                  required
                  type="email"
                  placeholder="you@yourworkshop.com"
                  className="w-full rounded-xl border border-[#dce5ef] bg-white px-4 py-3.5 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-[#26374e]">Password</span>
                <span className="relative block">
                  <input
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    name="password"
                    required
                    minLength={8}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="At least 8 characters"
                    className="w-full rounded-xl border border-[#dce5ef] bg-white px-4 py-3.5 pr-12 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#74839a] transition hover:text-[#26374e]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>
              {isSignUp && (
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-[#26374e]">Confirm password</span>
                  <input
                    autoComplete="new-password"
                    name="confirmPassword"
                    required
                    minLength={8}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Re-enter your password"
                    className="w-full rounded-xl border border-[#dce5ef] bg-white px-4 py-3.5 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10"
                  />
                </label>
              )}
              {error && (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b1c34] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#132b4b] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-[#66758b]">
              {isSignUp ? 'Already have an account?' : 'New to NEXTGEN?'}{' '}
              <button
                type="button"
                onClick={() => { setError(''); onModeChange(isSignUp ? 'signin' : 'signup'); }}
                className="font-bold text-[#1c5fa6] transition hover:text-[#174d86]"
              >
                {isSignUp ? 'Sign in' : 'Create an account'}
              </button>
            </p>

            <p className="mt-8 rounded-xl border border-[#e5ebf3] bg-white/70 px-4 py-3 text-center text-xs leading-5 text-[#66758b]">
              Your password is securely hashed before it is saved. Sign-in uses a protected server session.
            </p>
          </div>
          <div className="pb-2 text-center text-[11px] font-medium text-[#8897ab]">
            Driving Excellence Through Smart Vehicle Care.
          </div>
        </section>
      </div>
    </main>
  );
};
