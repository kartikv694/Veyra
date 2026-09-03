import Link from "next/link";
import { Users, Link2, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignalMotif } from "@/components/SignalMotif";
import { BrandMark } from "@/components/BrandMark";

export default function Home() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2">
          <BrandMark size={22} />
          <span className="font-display text-lg font-semibold">Veyra</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="hidden rounded-lg px-4 py-2 text-sm font-semibold text-ink transition-colors hover:text-accent sm:inline-block"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Register
          </Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 py-16 sm:px-10 md:grid-cols-2 md:py-24">
            <div className="relative z-10">
              <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
                Meetings that just work, for every seat at the table.
              </h1>
              <p className="mt-4 max-w-md text-base text-muted sm:text-lg">
                Create a room in seconds, share a link, and bring your whole team
                in — no downloads, no friction.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
              </div>
            </div>

            <div className="relative hidden aspect-square overflow-hidden rounded-2xl border border-edge bg-surface2 md:block dark:border-transparent dark:bg-[#0F1115]">
              <div className="absolute inset-0 opacity-70">
                <SignalMotif />
              </div>
              <div className="absolute bottom-6 left-6 right-6 text-ink/70 dark:text-white/70">
                <p className="text-sm">
                  Host, present, and talk with your team in real time.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-edge bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-14 sm:px-10">
            <div className="grid gap-8 sm:grid-cols-3">
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                  <Link2 size={18} className="text-accent" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold">
                  One link, instant room
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Create a meeting and share a single link — no setup required.
                </p>
              </div>
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent2/10">
                  <Users size={18} className="text-accent2" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold">
                  Built for teams
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Bring as many participants as you need into one room.
                </p>
              </div>
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                  <ShieldCheck size={18} className="text-accent" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold">
                  Secure by default
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Every room is private to the people you invite.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-edge px-6 py-8 text-center text-xs text-muted/70 sm:px-10">
        © 2026 Veyra. Built for teams that meet often.
      </footer>
    </div>
  );
}
