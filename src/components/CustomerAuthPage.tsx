import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Gauge, ShieldCheck } from 'lucide-react';
import { apiFetch, initializeCsrfToken } from '../api';

interface CustomerAuthProps {
  onAuthenticated: () => void;
  onBack: () => void;
}

export const CustomerAuthPage: React.FC<CustomerAuthProps> = ({ onAuthenticated, onBack }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get('password') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');
    setError('');
    if (mode === 'register' && password !== confirmPassword) {
      setError('Those passwords do not match. Please try again.');
      return;
    }
    setIsSubmitting(true);
    try {
      await initializeCsrfToken();
      const response = await apiFetch(`/api/customer/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register'
          ? { email: formData.get('email'), password, phone: formData.get('phone') }
          : { email: formData.get('email'), password }),
      }, false);
      const result = await response.json() as { error?: unknown };
      if (!response.ok) {
        throw new Error(typeof result.error === 'string' ? result.error : 'Unable to authenticate.');
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
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#39a8ff] text-[#081426]"><Gauge className="h-5 w-5" /></span>
            <span className="text-xl font-extrabold tracking-[0.12em]">NEXTGEN</span>
          </a>
          <div className="relative z-10 max-w-xl py-14">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#39a8ff]">Customer vehicle care</p>
            <h1 className="mt-5 text-5xl font-extrabold leading-[1.08] xl:text-6xl">
              {mode === 'register' ? 'Your vehicle care, all in one place.' : 'Your vehicle. Your repair. In view.'}
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-[#c5d3e4]">
              Follow service progress, review workshop updates, and keep your vehicle history close at hand.
            </p>
            <div className="mt-10 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#39a8ff]/10 text-[#39a8ff]"><ShieldCheck className="h-5 w-5" /></span>
              <div><p className="text-sm font-bold">A secure customer account</p><p className="mt-1 text-xs text-[#aebed3]">Only your vehicles and repair updates</p></div>
            </div>
          </div>
          <p className="relative z-10 text-xs font-medium text-[#91a4bd]">NEXTGEN – Vehicle Service and Repair Management System</p>
        </section>

        <section className="flex min-h-screen flex-col px-5 py-6 sm:px-10 lg:px-12 xl:px-20">
          <div className="flex items-center justify-between">
            <a href="#" className="flex items-center gap-2 lg:hidden" aria-label="NEXTGEN home" onClick={(event) => { event.preventDefault(); onBack(); }}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0b1c34] text-[#39a8ff]"><Gauge className="h-4 w-4" /></span>
              <span className="font-extrabold tracking-[0.12em]">NEXTGEN</span>
            </a>
            <button type="button" onClick={onBack} className="ml-auto inline-flex items-center gap-2 text-sm font-semibold text-[#627189] transition hover:text-[#27364b]">
              <ArrowLeft className="h-4 w-4" /> Back to home
            </button>
          </div>

          <div className="mx-auto my-auto w-full max-w-md py-12">
            <div className="mb-8">
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#1b72c7]">Customer portal</p>
              <h2 className="mt-3 text-3xl font-extrabold text-[#101c30] sm:text-4xl">
                {mode === 'register' ? 'Create your account' : 'Sign in to NEXTGEN'}
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#66758b]">
                {mode === 'register' ? 'Use the email and phone number registered with your workshop.' : 'View your vehicles, service history, and repair progress.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-[#26374e]">Email address</span>
                <input autoComplete="email" name="email" required type="email" className="w-full rounded-xl border border-[#dce5ef] bg-white px-4 py-3.5 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10" placeholder="you@example.com" />
              </label>
              {mode === 'register' && (
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-[#26374e]">Registered phone number</span>
                  <input autoComplete="tel" name="phone" required type="tel" className="w-full rounded-xl border border-[#dce5ef] bg-white px-4 py-3.5 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10" placeholder="Phone number on your workshop record" />
                  <span className="mt-1.5 block text-xs text-[#66758b]">We use this to verify the customer record before creating an account.</span>
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-[#26374e]">Password</span>
                <span className="relative block">
                  <input autoComplete={mode === 'register' ? 'new-password' : 'current-password'} name="password" required minLength={mode === 'register' ? 8 : 1} type={showPassword ? 'text' : 'password'} className="w-full rounded-xl border border-[#dce5ef] bg-white px-4 py-3.5 pr-12 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10" placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'} />
                  <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#74839a] transition hover:text-[#26374e]" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>
              {mode === 'register' && (
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-[#26374e]">Confirm password</span>
                  <input autoComplete="new-password" name="confirmPassword" required minLength={8} type={showPassword ? 'text' : 'password'} className="w-full rounded-xl border border-[#dce5ef] bg-white px-4 py-3.5 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10" placeholder="Re-enter your password" />
                </label>
              )}
              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
              <button type="submit" disabled={isSubmitting} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b1c34] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#132b4b] disabled:cursor-not-allowed disabled:opacity-60">
                {isSubmitting ? 'Please wait...' : mode === 'register' ? 'Create account' : 'Sign in'}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-[#66758b]">
              {mode === 'register' ? 'Already have an account?' : 'Need a customer account?'}{' '}
              <button type="button" onClick={() => { setError(''); setMode(mode === 'register' ? 'login' : 'register'); }} className="font-bold text-[#1c5fa6] transition hover:text-[#174d86]">
                {mode === 'register' ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          </div>
          <div className="pb-2 text-center text-[11px] font-medium text-[#8897ab]">Driving Excellence Through Smart Vehicle Care.</div>
        </section>
      </div>
    </main>
  );
};
