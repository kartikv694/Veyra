"use client";

/**
 * /dashboard
 *
 * Landing screen after login: create a new meeting (host flow), join one
 * by code (participant flow), and a "Recent meetings" list fetched from
 * GET /api/rooms.
 *
 * Guarded on mount via `checkAuth()` — a direct/bookmarked visit with no
 * valid session gets bounced to /login rather than rendering a page whose
 * API calls would just fail with 401s.
 *
 * Also honors an "intent" the landing page may have set before sending
 * someone here (?intent=create|join in the URL for an already-authenticated
 * visitor, or stashed in localStorage if they had to log in first): arriving
 * with intent=create auto-starts room creation; intent=join focuses the
 * join-code field. Either way the intent is consumed once and not reapplied
 * on a later visit.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, LogIn, Copy, Check, Users } from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLink } from "@/components/BrandLink";
import { UserMenu } from "@/components/UserMenu";
import { checkAuth, authHeaders, type SessionUser } from "@/lib/auth-client";

const INTENT_STORAGE_KEY = "veyra_intent";

interface MeetingSummary {
  id: number;
  token: string;
  link: string;
  createdAt: string;
  endAt: string | null;
  isHost: boolean;
  participantCount: number;
}

/** Reads the intent set by the landing page, checking the URL first (the
 *  already-authenticated path) and falling back to the stashed localStorage
 *  value (the "had to log in first" path). Consumes it either way. */
function consumeIntent(): "create" | "join" | null {
  const fromUrl = new URLSearchParams(window.location.search).get("intent");
  const fromStorage = window.localStorage.getItem(INTENT_STORAGE_KEY);
  window.localStorage.removeItem(INTENT_STORAGE_KEY);
  const intent = fromUrl ?? fromStorage;
  return intent === "create" || intent === "join" ? intent : null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [roomLink, setRoomLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const joinInputRef = useRef<HTMLInputElement>(null);

  const loadMeetings = async () => {
    const res = await fetch("/api/rooms", { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      setMeetings(data.meetings);
    }
  };

  const handleCreateRoom = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/rooms", { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't create the meeting. Please try again.");
        return;
      }
      setRoomLink(data.meeting.link);
      setCopied(false);
      toast.success("Meeting created — link ready to share.");
      loadMeetings();
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!roomLink) return;
    await navigator.clipboard.writeText(roomLink);
    setCopied(true);
    toast.success("Link copied.");
    setTimeout(() => setCopied(false), 1500);
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoining(true);
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          token: joinCode.trim(),
          ...(needsPasscode ? { passcode: joinPasscode } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 && data.error?.toLowerCase().includes("passcode")) {
          setNeedsPasscode(true);
          toast.error(needsPasscode ? "Incorrect passcode." : "This meeting needs a passcode.");
          return;
        }
        toast.error(data.error ?? "Couldn't join that meeting.");
        return;
      }
      toast.success("Joined the meeting.");
      router.push(`/room/${data.meeting.token}`);
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setJoining(false);
    }
  };

  // Auth guard + one-time intent handling, in that order: we don't act on
  // an intent until we know the session is actually valid.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const authedUser = await checkAuth();
      if (cancelled) return;

      if (!authedUser) {
        toast.error("Please sign in to continue.");
        router.push("/login");
        return;
      }

      setUser(authedUser);
      setCheckingAuth(false);
      await loadMeetings();

      const intent = consumeIntent();
      if (intent === "create") {
        handleCreateRoom();
      } else if (intent === "join") {
        joinInputRef.current?.focus();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checkingAuth || !user) {
    // Deliberately minimal — this should only ever flash briefly while
    // checkAuth() resolves.
    return <div className="min-h-screen bg-bg" />;
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="relative flex items-center justify-between border-b border-edge px-6 py-4 sm:px-10">
        <BrandLink size={22} />

        <nav className="absolute left-1/2 -translate-x-1/2" aria-label="Primary navigation">
          <Link
            href="/dashboard"
            aria-current="page"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
          >
            Dashboard
          </Link>
        </nav>

        <div className="flex items-center gap-4">
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-10">
        <h1 className="font-display text-2xl font-semibold">
          Good to see you, {user.name ?? user.email}
        </h1>
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
              disabled={creating}
              className="mt-4 w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {creating ? "Creating..." : "Create room"}
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
                ref={joinInputRef}
                type="text"
                required
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  setNeedsPasscode(false);
                  setJoinPasscode("");
                }}
                placeholder="e.g. 7fk-2xa-plm"
                className="w-full rounded-lg border border-edge bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
              {needsPasscode && (
                <input
                  type="password"
                  required
                  autoFocus
                  value={joinPasscode}
                  onChange={(e) => setJoinPasscode(e.target.value)}
                  placeholder="Meeting passcode"
                  className="w-full rounded-lg border border-edge bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-accent"
                />
              )}
              <button
                type="submit"
                disabled={joining}
                className="w-full rounded-lg border border-edge py-2.5 text-sm font-semibold transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
              >
                {joining ? "Joining..." : "Join"}
              </button>
            </form>
          </div>
        </div>

        <div className="mt-10">
          <h3 className="text-sm font-semibold text-muted">Recent meetings</h3>
          {meetings.length === 0 ? (
            <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-edge py-12 text-center">
              <Users size={22} className="text-muted" />
              <p className="mt-2 text-sm text-muted">No meetings yet — create your first room above.</p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-surface">
              {meetings.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.token}</p>
                    <p className="text-muted">
                      {m.isHost ? "You hosted" : "You joined"} · {m.participantCount} participant
                      {m.participantCount === 1 ? "" : "s"}
                      {m.endAt ? " · ended" : ""}
                    </p>
                  </div>
                  {m.endAt ? (
                    <span className="shrink-0 rounded-lg border border-edge bg-surface2 px-3 py-1.5 text-xs font-semibold text-muted">
                      Ended
                    </span>
                  ) : (
                    <button
                      onClick={() => router.push(`/room/${m.token}`)}
                      className="shrink-0 rounded-lg border border-edge px-3 py-1.5 text-xs font-semibold transition-colors hover:border-accent hover:text-accent"
                    >
                      Rejoin
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
