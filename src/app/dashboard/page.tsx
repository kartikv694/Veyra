"use client";

/**
 * /dashboard
 *
 * Landing screen after login: create a new meeting (host flow) or join one
 * by code (participant flow), plus a "Recent meetings" list. UI-only for
 * now — room creation generates a client-side placeholder token; see the
 * TODOs below for wiring to the live /api/rooms and /api/rooms/join
 * endpoints in Task 3.
 */
import { useState } from "react";
import { Plus, LogIn, Copy, Check, Users } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";

function generateRoomId() {
  const part = () => Math.random().toString(36).slice(2, 5);
  return `${part()}-${part()}-${part()}`;
}

export default function DashboardPage() {
  const [roomLink, setRoomLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState("");

  const handleCreateRoom = () => {
    // TODO (Task 3): wire to POST /api/rooms — endpoint already live, see README
    const id = generateRoomId();
    setRoomLink(`https://veyra.app/room/${id}`);
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!roomLink) return;
    await navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO (Task 3): wire to POST /api/rooms/join — endpoint already live, see README
  };

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-edge px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2">
          <BrandMark size={22} />
          <span className="font-display text-lg font-semibold">Veyra</span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface2 text-sm font-semibold">
            AK
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-10">
        <h1 className="font-display text-2xl font-semibold">Good to see you</h1>
        <p className="mt-1 text-sm text-muted">Start a new meeting or join one with a code.</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-edge bg-surface p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
              <Plus size={18} className="text-accent" />
            </div>
            <h2 className="mt-4 font-display text-lg font-semibold">New meeting</h2>
            <p className="mt-1 text-sm text-muted">
              You&apos;ll be assigned as host with full room controls.
            </p>
            <button
              onClick={handleCreateRoom}
              className="mt-4 w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Create room
            </button>

            {roomLink && (
              <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-edge bg-surface2 px-3 py-2.5">
                <span className="truncate text-sm text-muted">{roomLink}</span>
                <button onClick={handleCopy} aria-label="Copy link" className="shrink-0 text-accent">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-edge bg-surface p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent2/10">
              <LogIn size={18} className="text-accent2" />
            </div>
            <h2 className="mt-4 font-display text-lg font-semibold">Join meeting</h2>
            <p className="mt-1 text-sm text-muted">Enter a room code or paste a link.</p>
            <form onSubmit={handleJoin} className="mt-4 space-y-3">
              <input
                type="text"
                required
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="e.g. 7fk-2xa-plm"
                className="w-full rounded-lg border border-edge bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="w-full rounded-lg border border-edge py-2.5 text-sm font-semibold transition-colors hover:border-accent hover:text-accent"
              >
                Join
              </button>
            </form>
          </div>
        </div>

        <div className="mt-10">
          <h3 className="text-sm font-semibold text-muted">Recent meetings</h3>
          <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-edge py-12 text-center">
            <Users size={22} className="text-muted" />
            <p className="mt-2 text-sm text-muted">No meetings yet — create your first room above.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
