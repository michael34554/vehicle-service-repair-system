import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Gauge, LoaderCircle, ShieldCheck, UserRound } from 'lucide-react';
import { apiFetch, initializeCsrfToken } from '../api';

interface CustomerAuthProps {
  onAuthenticated: () => void;
  onBack: () => void;
}

interface CustomerSessionResponse {
  error?: string;
  message?: string;
}

export const CustomerAuthPage: React.FC<CustomerAuthProps> = ({ onAuthenticated, onBack }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function postCustomerAuth<T>(path: string, body: Record<string, string>): Promise<T> {
    await initializeCsrfToken();
    const response = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, false);
    let result: T & CustomerSessionResponse;
    try {
      result = await response.json() as T & CustomerSessionResponse;
    } catch {
      result = {} as T & CustomerSessionResponse;
    }
    if (!response.ok) {
      throw new Error(result.message || result.error || 'The request could not be completed. Please try again.');
    }
    return result;
  }

  const handleNameLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await postCustomerAuth<CustomerSessionResponse>('/api/customer/auth/name', {
        name: name.trim(),
      });
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
              Your vehicle. Your repair. In view.
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-[#c5d3e4]">
              Follow service progress, review workshop updates, and keep your vehicle history close at hand.
            </p>
            <div className="mt-10 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#39a8ff]/10 text-[#39a8ff]"><ShieldCheck className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-bold">Your customer record</p>
                <p className="mt-1 text-xs text-[#aebed3]">Only your vehicles and repair updates</p>
              </div>
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
                Sign in to NEXTGEN
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#66758b]">
                Enter the name registered on your workshop customer record.
              </p>
            </div>

            <form onSubmit={(event) => void handleNameLogin(event)} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-[#26374e]">Registered customer name</span>
                <span className="relative block">
                  <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8493a8]" />
                  <input
                    autoComplete="name"
                    name="name"
                    required
                    minLength={2}
                    maxLength={191}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-[#dce5ef] bg-white py-3.5 pl-10 pr-4 text-sm text-[#24344b] outline-none transition placeholder:text-[#8b99ac] focus:border-[#2794f4] focus:ring-4 focus:ring-[#2794f4]/10"
                    placeholder="Registered customer name"
                  />
                </span>
                <span className="mt-1.5 block text-xs text-[#66758b]">Use the exact name saved on your workshop customer record.</span>
              </label>

              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

              <button type="submit" disabled={isSubmitting} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b1c34] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#132b4b] disabled:cursor-not-allowed disabled:opacity-60">
                {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {isSubmitting ? 'Opening portal…' : 'Continue to portal'}
                {!isSubmitting && <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />}
              </button>
            </form>

            <p className="mt-6 text-center text-xs leading-5 text-[#8493a8]">
              Customer access uses only the registered customer name. Staff sign-in is unchanged.
            </p>
          </div>
          <div className="pb-2 text-center text-[11px] font-medium text-[#8897ab]">Driving Excellence Through Smart Vehicle Care.</div>
        </section>
      </div>
    </main>
  );
};
