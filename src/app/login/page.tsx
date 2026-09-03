"use client";

/**
 * /login
 *
 * Sign-in screen: split layout with the brand panel (SignalMotif) on the
 * left and the credentials form on the right. Submits to
 * POST /api/auth/login once wired up (Task 3); currently a UI-only stub —
 * see the TODO in handleSubmit.
 */
import Link from "next/link";
import { useState } from "react";
import { Mail, Lock } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignalMotif } from "@/components/SignalMotif";
import { BrandMark } from "@/components/BrandMark";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // TODO (Task 3): wire to POST /api/auth/login — endpoint already live, see README
    setTimeout(() => setLoading(false), 600);
  };

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-edge bg-surface2 p-10 text-ink md:flex dark:border-none dark:bg-[#0F1115] dark:text-white">
        <div className="flex items-center gap-2">
          <BrandMark size={22} />
          <span className="font-display text-lg font-semibold">Veyra</span>
        </div>
        <div className="absolute inset-0 opacity-70">
          <SignalMotif />
        </div>
        <div className="relative max-w-sm">
          <p className="font-display text-2xl font-medium leading-snug">
            Every seat connected, one room at a time.
          </p>
          <p className="mt-3 text-sm text-ink/60 dark:text-white/60">
            Host, present, and talk with your team in real time — no downloads required.
          </p>
        </div>
      </div>

      <div className="flex flex-col justify-between p-6 sm:p-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 md:hidden">
            <BrandMark size={22} />
            <span className="font-display text-lg font-semibold">Veyra</span>
          </div>
          <div />
          <ThemeToggle />
        </div>

        <div className="mx-auto w-full max-w-sm">
          <h1 className="font-display text-2xl font-semibold">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Sign in to create or join a meeting.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Email</label>
              <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2.5 focus-within:border-accent">
                <Mail size={16} className="text-muted" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Password</label>
              <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2.5 focus-within:border-accent">
                <Lock size={16} className="text-muted" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium text-accent">
              Create one
            </Link>
          </p>
        </div>

        <div className="text-center text-xs text-muted/70 md:text-left">
          © 2026 Veyra. Built for teams that meet often.
        </div>
      </div>
    </div>
  );
}
