"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Captions,
  Check,
  Copy,
  Grid3X3,
  Info,
  KeyRound,
  Languages,
  Lock,
  LockOpen,
  MessageSquare,
  Mic,
  MicOff,
  LayoutGrid,
  Hand,
  Send,
  Timer,
  UserPlus,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { BrandLink } from "@/components/BrandLink";
import { toast, confirmToast } from "@/lib/toast";
import { VideoTile } from "@/components/VideoTile";
import { ControlBar } from "@/components/ControlBar";
import { ParticipantList, type ParticipantRow } from "@/components/ParticipantList";
import { LoadingScreen } from "@/components/LoadingScreen";
import { checkAuth, authHeaders, type SessionUser } from "@/lib/auth-client";
import { useMeetingRoom } from "@/hooks/useMeetingRoom";

/**
 * The Web Speech API's SpeechRecognition isn't part of TypeScript's
 * default DOM lib (it's non-standard, Chrome/Edge-only), so a minimal
 * shape is declared here rather than reaching for `any` everywhere
 * captions logic touches it.
 */
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: { [i: number]: { [j: number]: { transcript: string } } } & { length: number } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type Panel = "people" | "chat" | "tools" | null;

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ReadyMeetingCard({
  token, inviteInput, setInviteInput, inviting, handleInvite, linkCopied, setLinkCopied, onClose,
}: {
  token: string; inviteInput: string; setInviteInput: (value: string) => void; inviting: boolean;
  handleInvite: () => Promise<void>; linkCopied: boolean; setLinkCopied: (value: boolean) => void; onClose: () => void;
}) {
  const link = typeof window !== "undefined" ? `${window.location.origin}/room/${token}` : `/room/${token}`;
  const copyLink = async () => {
    await navigator.clipboard.writeText(link); setLinkCopied(true); toast.success("Link copied.");
    window.setTimeout(() => setLinkCopied(false), 1500);
  };
  return (
    <div className="fixed left-4 top-16 z-[70] w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-[#202124] p-5 text-white shadow-2xl sm:left-6 sm:top-20">
      <div className="flex items-start justify-between"><h2 className="text-lg font-medium">Your meeting&apos;s ready</h2>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white"><X size={18} /></button></div>
      <p className="mt-2 text-sm text-white/60">Add people to your meeting or share the link. People on the invite list can join directly.</p>
      <button onClick={async () => { if (navigator.share) { try { await navigator.share({ title: "Join my Veyra meeting", url: link }); return; } catch { } } await copyLink(); }} className="mt-4 flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"><UserPlus size={16} /> Add others</button>
      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2.5"><span className="truncate text-sm text-white/85">{typeof window !== "undefined" ? window.location.host : "localhost:3000"}/room/{token}</span><button onClick={() => void copyLink()} aria-label="Copy link" className="shrink-0 text-white/60 hover:text-white">{linkCopied ? <Check size={16} /> : <Copy size={16} />}</button></div>
      <p className="mt-4 flex items-start gap-2 text-xs text-white/45"><Lock size={13} className="mt-0.5 shrink-0" />People who use the link must be admitted unless their email is on the meeting invite list.</p>
      <div className="mt-4 border-t border-white/10 pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-white/35">Invite by email</p><p className="mt-1 text-xs text-white/45">Add one or more email addresses. They can join directly once they sign in with that email.</p>
        <div className="mt-2 flex gap-2"><input value={inviteInput} onChange={e => setInviteInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleInvite(); } }} placeholder="name@example.com, another@example.com" className="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30" /><button onClick={() => void handleInvite()} disabled={inviting || !inviteInput.trim()} className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{inviting ? "..." : "Invite"}</button></div>
      </div>
    </div>
  );
}

function MeetingPanel({
  panel,
  participants,
  viewerIsHost,
  onClose,
  onMute,
  onCameraOff,
  onRemove,
  onMuteAll,
  onUnmuteAll,
  onCameraOffAll,
  onCameraOnAll,
  pendingRequests,
  onAdmit,
  onDeny,
  message,
  setMessage,
  captionsOn,
  onToggleCaptions,
  layoutMode,
  onCycleLayout,
  timerRemaining,
  onStartTimer,
  onStopTimer,
  chatMessages,
  onSendChat,
  myUserId,
}: {
  panel: Panel;
  participants: ParticipantRow[];
  viewerIsHost: boolean;
  onClose: () => void;
  onMute: (userId: number) => void;
  onCameraOff: (userId: number) => void;
  onRemove: (userId: number) => void;
  onMuteAll: () => void;
  onUnmuteAll: () => void;
  onCameraOffAll: () => void;
  onCameraOnAll: () => void;
  pendingRequests: { id: number; userId: number; name: string; requestedAt: string }[];
  onAdmit: (requestId: number) => void;
  onDeny: (requestId: number) => void;
  message: string;
  setMessage: (value: string) => void;
  captionsOn: boolean;
  onToggleCaptions: () => void;
  layoutMode: "auto" | "spotlight";
  onCycleLayout: () => void;
  timerRemaining: number | null;
  onStartTimer: () => void;
  onStopTimer: () => void;
  chatMessages: { id: string; text: string; fromName: string; fromUserId: number; at: number }[];
  onSendChat: (text: string) => void;
  myUserId: number | null;
}) {
  if (!panel) return null;

  return (
    <aside className="absolute inset-x-0 top-0 bottom-24 z-30 flex flex-col overflow-hidden bg-[#202124] shadow-2xl ring-1 ring-white/10 sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-24 sm:w-[min(360px,calc(100vw-16px))] sm:rounded-2xl">
      {panel === "people" && (
        <ParticipantList
          open
          participants={participants}
          onClose={onClose}
          viewerIsHost={viewerIsHost}
          onMute={onMute}
          onCameraOff={onCameraOff}
          onRemove={onRemove}
          onMuteAll={onMuteAll}
          onUnmuteAll={onUnmuteAll}
          onCameraOffAll={onCameraOffAll}
          onCameraOnAll={onCameraOnAll}
          pendingRequests={pendingRequests}
          onAdmit={onAdmit}
          onDeny={onDeny}
        />
      )}

      {panel === "chat" && (
        <div className="flex h-full flex-col text-white">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <h2 className="text-xl font-medium">In-call messages</h2>
            <button onClick={onClose} className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close chat">
              <X size={20} />
            </button>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-3 overflow-y-auto p-4">
            {chatMessages.length === 0 ? (
              <div className="rounded-xl bg-[#2b2c30] p-4 text-sm text-white/75">
                <div className="mb-2 flex items-center gap-2 font-medium text-white">
                  <MessageSquare size={16} />
                  Meeting chat
                </div>
                <p className="leading-6 text-white/55">
                  Messages here are live only — sent to everyone currently in the meeting, not saved anywhere.
                </p>
              </div>
            ) : (
              chatMessages.map((msg) => {
                const isMine = msg.fromUserId === myUserId;
                return (
                  <div key={msg.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                    <span className="mb-1 px-1 text-xs text-white/40">
                      {isMine ? "You" : msg.fromName} · {formatTime(new Date(msg.at))}
                    </span>
                    <span
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${isMine ? "bg-accent text-white" : "bg-[#2b2c30] text-white/90"
                        }`}
                    >
                      {msg.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-white/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="rounded-full border border-white/15 bg-[#1a1b1e] px-4 py-2">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = message.trim();
                  if (!trimmed) return;
                  onSendChat(trimmed);
                  setMessage("");
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Send a message"
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                />
                <button type="submit" aria-label="Send message" disabled={!message.trim()} className="rounded-full p-1.5 text-white/50 hover:text-white disabled:opacity-40">
                  <Send size={18} />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {panel === "tools" && (
        <div className="flex h-full flex-col text-white">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <h2 className="text-xl font-medium">Meeting tools</h2>
            <button onClick={onClose} className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close tools">
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-4 flex gap-2 border-b border-white/10 pb-3 text-sm">
              <span className="border-b-2 border-white px-3 pb-3 font-medium">Tools</span>
              <span className="px-3 pb-3 text-white/45">Add-ons</span>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => toast.info("Speech translation needs a translation service that isn't configured yet.")}
                className="flex w-full items-center gap-4 rounded-2xl bg-[#2b2c30] p-4 text-left transition hover:bg-[#34353a]"
              >
                <Languages className="text-violet-300" size={21} />
                <span className="flex-1"><strong className="block text-sm font-medium">Speech translation</strong><small className="text-white/45">Translate spoken audio</small></span>
                <span className="text-white/35">›</span>
              </button>
              <button
                onClick={timerRemaining !== null ? onStopTimer : onStartTimer}
                className="flex w-full items-center gap-4 rounded-2xl bg-[#2b2c30] p-4 text-left transition hover:bg-[#34353a]"
              >
                <Timer className="text-purple-300" size={21} />
                <span className="flex-1">
                  <strong className="block text-sm font-medium">Timer</strong>
                  <small className="text-white/45">
                    {timerRemaining !== null
                      ? `${Math.floor(timerRemaining / 60)}:${String(timerRemaining % 60).padStart(2, "0")} remaining — tap to stop`
                      : "Show a countdown timer"}
                  </small>
                </span>
                <span className="text-white/35">›</span>
              </button>
              <div className="pt-4 text-xs font-semibold uppercase tracking-wider text-white/35">More tools</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={onToggleCaptions}
                  className={`rounded-2xl border p-4 text-left transition ${captionsOn ? "border-accent bg-accent/10 text-white" : "border-white/10 text-white/55 hover:bg-white/5"
                    }`}
                >
                  <Captions size={19} className="mb-3" />
                  <span className="text-sm">{captionsOn ? "Captions on" : "Captions"}</span>
                </button>
                <button
                  onClick={onCycleLayout}
                  className="rounded-2xl border border-white/10 p-4 text-left text-white/55 transition hover:bg-white/5"
                >
                  <Grid3X3 size={19} className="mb-3" />
                  <span className="text-sm">Layout: {layoutMode === "auto" ? "Auto" : "Spotlight"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [joined, setJoined] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [hostCheckDone, setHostCheckDone] = useState(false);
  const [joining, setJoiningRoom] = useState(false);
  const [waitingForAdmission, setWaitingForAdmission] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<
    { id: number; userId: number; name: string; requestedAt: string }[]
  >([]);
  const [inviteInput, setInviteInput] = useState("");
  const [inviting, setInviting] = useState(false);
  const [me, setMe] = useState<SessionUser | null>(null);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // Remembers the last mic/camera toggle across a refresh — without this,
  // reloading the page always re-acquires the camera/mic as "on" by
  // default (that's just what getUserMedia gives you), ignoring that the
  // person had deliberately turned them off a moment ago. This is a
  // per-browser preference, not meeting state, so localStorage (not the
  // server) is the right place for it.
  const [micOn, setMicOn] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("veyra:mic-pref") !== "off";
  });
  const [cameraOn, setCameraOn] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("veyra:camera-pref") !== "off";
  });
  // True while the host has force-muted/force-cammed-off this participant
  // and hasn't released it yet — while true, this person's own mic/camera
  // buttons are disabled entirely, not just toggled off, so they can't
  // just click themselves back on. Only clears when the host explicitly
  // releases it (see onForceUnmuted/onForceCameraOn below).
  const [micLocked, setMicLocked] = useState(false);
  const [cameraLocked, setCameraLocked] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [message, setMessage] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [locked, setLocked] = useState(false);
  const [passcodeSet, setPasscodeSet] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [showShareWarning, setShowShareWarning] = useState(false);
  // Lazy initializer runs synchronously during the very first render, on
  // the client — reading window.location.search here (rather than in a
  // useEffect that runs after mount) removes any timing gap where a
  // stale/not-yet-updated URL could be read relative to Next's
  // client-side navigation finishing.
  // The ready card is enabled only after the server confirms that the
  // authenticated user is the meeting host. A `fresh=1` URL alone must
  // never put a participant into the host UI.
  const [showReadyCard, setShowReadyCard] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionText, setCaptionText] = useState("");
  const [layoutMode, setLayoutMode] = useState<"auto" | "spotlight">("auto");
  const [timerRemaining, setTimerRemaining] = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; fromName: string }[]>([]);
  const [chatMessages, setChatMessages] = useState<
    { id: string; text: string; fromName: string; fromUserId: number; at: number }[]
  >([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const exitMeeting = useCallback(
    (reason: "left" | "removed" | "ended") => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      router.push(`/meeting-ended/${token}?reason=${reason}`);
    },
    [router, token],
  );

  // Fallback for "host ends the meeting": the socket push (meeting:ended)
  // is the fast path, firing immediately. This is the guaranteed path —
  // without it, a dropped or delayed socket event (which can happen
  // whenever the signaling connection is unstable) leaves a participant
  // stuck in an already-ended room with no way to find out, since
  // nothing else here was actually checking Meeting.endAt despite the
  // end route's own comment claiming this fallback existed.
  //
  // Also reconciles the participants roster on every tick — this is what
  // fixes a refresh incorrectly showing "left": when a participant
  // refreshes, their old socket disconnects (broadcasting peer:left)
  // before their new page has finished reconnecting (broadcasting
  // peer:joined back). If the backend is at all slow to respond in that
  // gap — which a cold-starting host is exactly the kind of thing that
  // causes — that "left" state can visibly linger far longer than it
  // should. Polling the database (the actual source of truth, where
  // leftAt gets correctly cleared the moment they rejoin) lets it
  // self-correct within one tick, independent of socket timing.
  useEffect(() => {
    if (!joined) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/rooms/${token}`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (data.meeting?.endAt) {
          exitMeeting("ended");
          return;
        }
        if (Array.isArray(data.participants)) setParticipants(data.participants);
      } catch {
        // Transient network hiccup — the next tick retries.
      }
    }, 5000);
    return () => clearInterval(id);
  }, [joined, token, exitMeeting]);

  // Fallback for join requests reaching the host: join-request:new is the
  // fast path (near-instant when the signaling connection is healthy),
  // but same reasoning as above — if the backend is slow to relay it,
  // the host had no way to find out short of refreshing the page
  // themselves, despite this endpoint's own comment claiming the socket
  // push made a re-fetch unnecessary. Polling every 3s (matching the
  // waiting-room side's own poll interval) keeps this to a few seconds
  // at most, regardless of the socket's timing, without needing a
  // manual refresh — merges by id so an eventually-arriving socket event
  // for the same request doesn't create a duplicate.
  useEffect(() => {
    if (!joined || !isHost) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/rooms/${token}/join-requests`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data.requests)) return;
        setPendingRequests((prev) => {
          const known = new Set(prev.map((r) => r.id));
          const fresh = data.requests.filter((r: { id: number }) => !known.has(r.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      } catch {
        // Transient network hiccup — the next tick retries.
      }
    };
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [joined, isHost, token]);

  // Recovers chat history on join/refresh — without this, chatMessages
  // always started empty regardless of what was actually said earlier in
  // the meeting, since messages only ever arrived live over the socket
  // and nothing populated the initial state from what's already been
  // sent. Runs once per join, not on every render — chatMessages itself
  // isn't a dependency here on purpose, since new live messages append
  // to it locally and shouldn't re-trigger a full re-fetch.
  useEffect(() => {
    if (!joined) return;
    console.info("[Veyra] Fetching chat history for", token);
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${token}/chat`, { headers: authHeaders() });
        console.info("[Veyra] Chat history response status:", res.status);
        if (!res.ok) {
          console.error(`[Veyra] Failed to load chat history: ${res.status}`, await res.json().catch(() => null));
          return;
        }
        const data = await res.json();
        console.info("[Veyra] Chat history payload:", data);
        if (Array.isArray(data.messages)) {
          console.info(`[Veyra] Loaded ${data.messages.length} chat message(s) from history`);
          setChatMessages(
            data.messages.map((m: { id: number; userId: number; fromName: string; text: string; at: number }) => ({
              id: `history-${m.id}`,
              text: m.text,
              fromName: m.fromName,
              fromUserId: m.userId,
              at: m.at,
            })),
          );
        } else {
          console.error("[Veyra] Chat history payload had no messages array:", data);
        }
      } catch (err) {
        // Chat still works live even if history fails to load — this
        // just means starting from an empty history — but logged
        // rather than silently swallowed, since a previous version of
        // this catch had no visibility into failures at all.
        console.error("[Veyra] Failed to load chat history", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, token]);

  const {
    peers,
    connected,
    broadcastMediaState,
    emitHostControl,
    addScreenShareTrack,
    removeScreenShareTrack,
    broadcastScreenShareState,
    broadcastHandRaise,
    sendReaction,
    sendChatMessage,
  } = useMeetingRoom(
    token,
    localStream,
    me?.id ?? null,
    {
      onForceMuted: () => {
        streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = false));
        setMicOn(false);
        setMicLocked(true);
        toast.info("The host muted you. You can't unmute yourself until the host allows it.");
      },
      onForceUnmuted: () => {
        // Only unlocks the button — does NOT turn the mic on for them.
        // Track stays disabled and micOn stays false until the
        // participant clicks their own mic button themselves.
        setMicLocked(false);
        toast.info("The host allowed your microphone — click the mic button to turn it on.");
      },
      onForceCameraOff: () => {
        streamRef.current?.getVideoTracks().forEach((track) => (track.enabled = false));
        setCameraOn(false);
        setCameraLocked(true);
        toast.info("The host turned off your camera. You can't turn it back on until the host allows it.");
      },
      onForceCameraOn: () => {
        // Only unlocks the button — does NOT turn the camera on for
        // them. Same reasoning as onForceUnmuted above.
        setCameraLocked(false);
        toast.info("The host allowed your camera — click the camera button to turn it on.");
      },
      onJoinRequest: (request) => {
        setPendingRequests((prev) =>
          prev.some((r) => r.id === request.requestId)
            ? prev
            : [...prev, { id: request.requestId, userId: request.userId, name: request.name, requestedAt: new Date().toISOString() }],
        );
        toast.info(`${request.name} is asking to join.`);
      },
      onPeerJoined: (peer) => {
        setParticipants((prev) => {
          const existing = prev.find((p) => p.userId === peer.userId);
          if (existing) {
            return prev.map((p) => p.userId === peer.userId ? { ...p, name: peer.name, isHost: Boolean(peer.isHost), isMuted: peer.isMuted ?? p.isMuted, isCameraOff: peer.isCameraOff ?? p.isCameraOff, leftAt: null } : p);
          }
          return [...prev, {
            userId: peer.userId,
            name: peer.name,
            isHost: Boolean(peer.isHost),
            isMuted: Boolean(peer.isMuted),
            isCameraOff: Boolean(peer.isCameraOff),
            joinedAt: new Date().toISOString(),
            leftAt: null,
          }];
        });
      },
      onPeerLeft: ({ userId }) => {
        setParticipants((prev) => prev.map((p) => p.userId === userId ? { ...p, leftAt: new Date().toISOString() } : p));
      },
      onRemoved: () => {
        exitMeeting("removed");
      },
      onMeetingEnded: () => {
        exitMeeting("ended");
      },
      onReaction: (emoji, fromName) => {
        setReactions((prev) => [...prev, { id: Math.random().toString(36).slice(2), emoji, fromName }]);
      },
      onChatMessage: (msg) => {
        setChatMessages((prev) => [...prev, { id: `${msg.at}-${msg.fromUserId}-${Math.random()}`, ...msg }]);
      },
    },
    joined,
  );

  /**
   * What the lobby's "Join now" button actually does: calls the real join
   * endpoint (auto-rejoin logic — see that route's docs for why this is
   * safe to call even for a returning participant), and only flips
   * `joined` to true on success. `useMeetingRoom` doesn't connect its
   * socket until `joined` is true (see the `enabled` arg on that hook
   * call below), so nothing about the live call — WebRTC, roster
   * polling, the other participants seeing you — starts until this
   * succeeds. Before this point you're only ever previewing your own
   * camera locally; nobody else knows you're here yet.
   */
  const handleJoinFromLobby = async (hostUserId?: number) => {
    setJoiningRoom(true);
    try {
      const joinRes = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ token }),
      });
      const data = await joinRes.json().catch(() => ({}));

      if (joinRes.status === 202) {
        // Not pre-approved — the host has to admit us. Show the waiting
        // screen; the polling effect below takes it from here.
        setWaitingForAdmission(true);
        return;
      }
      if (!joinRes.ok) {
        toast.error(data.error ?? "Couldn't join this meeting.");
        return;
      }
      if (Array.isArray(data.participants)) setParticipants(data.participants);
      setMicLocked(Boolean(data.participant?.isMuted));
      setCameraLocked(Boolean(data.participant?.isCameraOff));
      if (data.participant?.isMuted) {
        streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = false));
        setMicOn(false);
      }
      if (data.participant?.isCameraOff) {
        streamRef.current?.getVideoTracks().forEach((track) => (track.enabled = false));
        setCameraOn(false);
      }
      if (data.meeting) {
        setLocked(Boolean(data.meeting.locked));
        setPasscodeSet(Boolean(data.meeting.passcodeSet));
      }
      const fresh = new URLSearchParams(window.location.search).get("fresh") === "1";
      if (fresh && data.meeting?.hostId === (hostUserId ?? me?.id)) {
        setShowReadyCard(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
      setJoined(true);
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setJoiningRoom(false);
    }
  };

  // While waiting to be admitted, poll for a decision. This can't use
  // the meeting socket — that only accepts connections from people who
  // are already active participants, which we aren't yet — so a simple
  // poll is the reliable way to find out once the host decides.
  useEffect(() => {
    if (!waitingForAdmission) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/rooms/${token}/join-requests/mine`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "ADMITTED") {
          setWaitingForAdmission(false);
          const joinRes = await fetch("/api/rooms/join", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ token }),
          });
          if (joinRes.ok) {
            const joinedData = await joinRes.json().catch(() => ({}));
            if (Array.isArray(joinedData.participants)) setParticipants(joinedData.participants);
            setMicLocked(Boolean(joinedData.participant?.isMuted));
            setCameraLocked(Boolean(joinedData.participant?.isCameraOff));
            if (joinedData.participant?.isMuted) {
              streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = false));
              setMicOn(false);
            }
            if (joinedData.participant?.isCameraOff) {
              streamRef.current?.getVideoTracks().forEach((track) => (track.enabled = false));
              setCameraOn(false);
            }
            if (joinedData.meeting) {
              setLocked(Boolean(joinedData.meeting.locked));
              setPasscodeSet(Boolean(joinedData.meeting.passcodeSet));
            }
            setJoined(true);
          }
        } else if (data.status === "DENIED") {
          setWaitingForAdmission(false);
          toast.error("The host didn't admit you to this meeting.");
          router.push("/dashboard");
        }
      } catch {
        // Transient network hiccup — the next poll tick retries.
      }
    };
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [waitingForAdmission, token, router]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await checkAuth();
      if (cancelled) return;
      if (!user) {
        toast.error("Please sign in to continue.");
        router.push(`/login?next=${encodeURIComponent(`/room/${token}`)}`);
        return;
      }

      setMe(user);
      setCheckingAuth(false);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // 960x540 is a good local preview target for a mesh call: the
          // browser still adapts to the display, while camera capture and
          // encoding start with less CPU pressure than a 1280x720 request.
          video: { aspectRatio: { ideal: 16 / 9 }, width: { ideal: 960 }, height: { ideal: 540 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        // getUserMedia always hands back enabled tracks — apply whatever
        // was remembered from before the refresh, using the state
        // variables above (already initialized from localStorage) rather
        // than re-reading it, so this stays in sync with what the rest
        // of the component believes micOn/cameraOn to be.
        stream.getAudioTracks().forEach((track) => (track.enabled = micOn));
        stream.getVideoTracks().forEach((track) => (track.enabled = cameraOn));
        streamRef.current = stream;
        setLocalStream(stream);
      } catch (err) {
        setCameraOn(false);
        setMicOn(false);
        const name = err instanceof Error ? err.name : "";
        if (name === "NotReadableError" || name === "TrackStartError") {
          // This is what actually happens when testing two participants
          // on the same machine with one physical webcam: the OS/browser
          // only lets one tab (or app) use a given camera at a time. This
          // isn't a bug to fix in code — it's a real hardware limit. The
          // second tab genuinely cannot get the camera while the first
          // tab holds it open, on any video-calling app, not just this
          // one. Testing multiple real cameras needs separate physical
          // devices (a phone + a computer, or two computers).
          toast.warning(
            "Your camera is already in use by another tab or app — only one can use it at a time. You can still join with camera off, or close the other tab using it.",
          );
        } else if (name === "NotFoundError") {
          toast.warning("No camera or microphone was found on this device. You can still join.");
        } else if (name === "NotAllowedError") {
          toast.warning("Camera/microphone permission was denied. You can still join with them off.");
        } else {
          toast.warning("Camera or microphone access was unavailable. You can still join the meeting.");
        }
      }

      // The host bypasses the participant lobby. This small access lookup
      // also avoids the old sequence of GET room -> POST join -> GET room:
      // once we know the host, the join response is used to populate the
      // roster directly.
      try {
        const res = await fetch(`/api/rooms/${token}`, {
          headers: authHeaders(),
          cache: "no-store",
        });

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();

          const userIsHost = data.meeting?.hostId === user.id;

          setIsHost(userIsHost);
          setHostCheckDone(true);

          if (userIsHost) {
            if (Array.isArray(data.participants)) {
              setParticipants(data.participants);
            }

            setLocked(Boolean(data.meeting?.locked));
            setPasscodeSet(Boolean(data.meeting?.passcodeSet));

            // Hosts bypass the participant lobby completely.
            // Pass the authenticated user's id directly so the fresh=1
            // ready-card check does not depend on asynchronous React state.
            void handleJoinFromLobby(user.id);
          }
        } else {
          setHostCheckDone(true);
        }
      } catch {
        // Network hiccup — allow the normal participant flow to continue.
        setHostCheckDone(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!joined) return;
    // The route itself 403s for a non-host caller, so this is safe to
    // fire unconditionally — it just quietly does nothing for everyone
    // else instead of needing to know our own host status this early.
    fetch(`/api/rooms/${token}/join-requests`, { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.requests) setPendingRequests(data.requests);
      })
      .catch(() => undefined);
  }, [joined, token]);

  const toggleMic = () => {
    if (micLocked) {
      toast.info("The host muted you — only the host can turn your mic back on.");
      return;
    }
    const stream = streamRef.current;
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach((track) => (track.enabled = next));
    setMicOn(next);
    window.localStorage.setItem("veyra:mic-pref", next ? "on" : "off");
    broadcastMediaState(next, cameraOn);
  };

  const toggleCamera = () => {
    if (cameraLocked) {
      toast.info("The host turned off your camera — only the host can turn it back on.");
      return;
    }
    const stream = streamRef.current;
    if (!stream) return;
    const next = !cameraOn;
    stream.getVideoTracks().forEach((track) => (track.enabled = next));
    setCameraOn(next);
    window.localStorage.setItem("veyra:camera-pref", next ? "on" : "off");
    broadcastMediaState(micOn, next);
  };

  const handleToggleHandRaise = () => {
    const next = !handRaised;
    setHandRaised(next);
    broadcastHandRaise(next);
    toast.info(next ? "You raised your hand." : "You lowered your hand.");
  };

  /**
   * Live captions of your OWN speech via the browser's built-in
   * SpeechRecognition (Web Speech API) — Chrome/Edge only, no external
   * service required, which is also its limit: it only captions the
   * local mic, not other participants' audio (captioning remote WebRTC
   * audio streams would need a server-side transcription service this
   * app doesn't have configured).
   */
  const toggleCaptions = () => {
    if (captionsOn) {
      const recognition = recognitionRef.current;
      recognitionRef.current = null; // clear first so onend below doesn't auto-restart
      recognition?.stop();
      setCaptionsOn(false);
      setCaptionText("");
      return;
    }

    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      toast.error("Captions need Chrome or Edge — not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let consecutiveFailures = 0;

    recognition.onresult = (event) => {
      consecutiveFailures = 0; // a real result came back — recognition is working
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setCaptionText(transcript);
    };
    recognition.onerror = (event) => {
      // "no-speech"/"aborted" are normal transient hiccups — onend below
      // restarts recognition automatically while captions are still on.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Captions need microphone access — check your browser's site permissions.");
        recognitionRef.current = null;
        setCaptionsOn(false);
        return;
      }
      if (event.error === "network") {
        // Chrome's built-in recognition is cloud-based — it needs a live
        // connection to Google's speech service even though it's
        // captioning local audio. This is the most common real-world
        // failure and was previously swallowed silently (captions stayed
        // "on" forever with nothing appearing) — now it's surfaced.
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          toast.error("Captions can't reach the speech service — check your internet connection.");
          recognitionRef.current = null;
          setCaptionsOn(false);
        }
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current) {
        try {
          recognition.start();
        } catch {
          // Already running, or the browser refused to restart it — stop
          // trying rather than loop silently forever.
          recognitionRef.current = null;
          setCaptionsOn(false);
        }
      }
    };
    try {
      recognition.start();
    } catch {
      toast.error("Couldn't start captions — try toggling them off and on again.");
      return;
    }
    recognitionRef.current = recognition;
    setCaptionsOn(true);
    toast.success("Captions on — captioning your own speech.");
  };

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.stop();
    };
  }, []);

  const cycleLayout = () => {
    const next = layoutMode === "auto" ? "spotlight" : "auto";
    setLayoutMode(next);
    toast.info(next === "spotlight" ? "Layout: Spotlight" : "Layout: Auto");
  };

  const startTimer = () => {
    const input = window.prompt("Countdown length in minutes:", "5");
    if (input === null) return;
    const minutes = Number(input);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast.error("Enter a whole number of minutes greater than 0.");
      return;
    }
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setTimerRemaining(Math.round(minutes * 60));
    timerIntervalRef.current = setInterval(() => {
      setTimerRemaining((prev) => {
        if (prev === null || prev <= 1) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          toast.info("Timer's up.");
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    toast.success(`Timer started for ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
    setTimerRemaining(null);
  };

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  const handleReact = (emoji: string) => {
    // The server echoes reactions back to everyone including the sender
    // (see server.ts), so this alone is enough — no need to also add it
    // locally here, which would show your own reaction twice.
    sendReaction(emoji);
  };

  // Each reaction bubble clears itself after a few seconds.
  useEffect(() => {
    if (reactions.length === 0) return;
    const timer = setTimeout(() => setReactions((prev) => prev.slice(1)), 3000);
    return () => clearTimeout(timer);
  }, [reactions]);

  const peerCount = peers.length;
  useEffect(() => {
    // Deliberately includes micOn/cameraOn in the dependency array (no
    // eslint-disable here) — leaving them out was a real bug: this
    // effect could fire (e.g. right as a new peer connects, which
    // happens a lot during the renegotiation activity screen-sharing
    // triggers) using a stale closure over an older cameraOn/micOn
    // value, re-broadcasting "camera on" moments after a correct
    // "camera off" had already gone out. Receivers would then show the
    // video element (since their copy of cameraOn said true again)
    // while the actual track stayed disabled — producing a black tile
    // instead of the avatar fallback.
    if (connected) broadcastMediaState(micOn, cameraOn);
  }, [peerCount, connected, micOn, cameraOn, broadcastMediaState]);

  const stopScreenShare = useCallback(() => {
    const track = screenStreamRef.current?.getVideoTracks()[0];
    if (track) removeScreenShareTrack(track);
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setSharingScreen(false);
    setScreenStream(null);
    broadcastScreenShareState(false);
  }, [removeScreenShareTrack, broadcastScreenShareState]);

  const startScreenShare = async () => {
    setShowShareWarning(false);
    try {
      // selfBrowserSurface: "exclude" removes THIS tab from the browser's
      // own share picker (supported in current Chrome/Edge) — this is
      // what actually prevents the recursive mirror, not just warns about
      // it: if the tab running this meeting isn't offered as an option,
      // it can't be selected. Ignored harmlessly on browsers that don't
      // support the option, which is why the warning dialog before this
      // call still exists as a fallback for those.
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        selfBrowserSurface: "exclude",
      } as DisplayMediaStreamOptions);
      const screenTrack = display.getVideoTracks()[0];
      screenStreamRef.current = display;
      setSharingScreen(true);
      setScreenStream(display);
      // A genuinely separate sender, not a replacement for the camera
      // track — this is what makes the screen show up as its own tile
      // for everyone else (matching Meet), with your camera still
      // showing normally alongside it, instead of your screen taking
      // over your camera's slot.
      addScreenShareTrack(screenTrack, display);
      broadcastScreenShareState(true);
      // The browser's own native "Stop sharing" control also needs to revert us.
      screenTrack.onended = stopScreenShare;
      toast.success("Sharing your screen.");
    } catch {
      // Picker cancelled, or permission denied — not worth an error toast.
    }
  };

  const handleScreenShareClick = () => {
    if (sharingScreen) {
      stopScreenShare();
      toast.info("Stopped sharing your screen.");
      return;
    }
    // Don't jump straight to the OS picker — warn first. Sharing this
    // browser's own tab/window creates a recursive "infinite mirror"
    // (the shared video showing itself, showing itself...), which is
    // confusing and expensive to render. The picker itself can't be
    // restricted from here, so this is a heads-up, not a hard block.
    setShowShareWarning(true);
  };

  const handleLeave = async () => {
    if (leaving) return; // guards against a rapid double-click firing before the disabled state re-renders
    setLeaving(true);
    try {
      const res = await fetch("/api/rooms/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't leave the meeting.");
        return;
      }
      toast.success("You left the meeting.");
      exitMeeting("left");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLeaving(false);
    }
  };

  const handleMuteParticipant = async (userId: number) => {
    try {
      const res = await fetch(`/api/rooms/${token}/participants/${userId}/mute`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't mute that participant.");
      setParticipants((prev) => prev.map((p) => p.userId === data.userId ? { ...p, isMuted: Boolean(data.muted) } : p));
      emitHostControl("host:mute-participant", { userId: data.userId, muted: Boolean(data.muted) });
      toast.success(data.muted ? "Participant muted." : "Participant unmuted.");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleCameraOffParticipant = async (userId: number) => {
    try {
      const res = await fetch(`/api/rooms/${token}/participants/${userId}/camera-off`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't turn off that participant's camera.");
      setParticipants((prev) => prev.map((p) => p.userId === data.userId ? { ...p, isCameraOff: Boolean(data.cameraOff) } : p));
      emitHostControl("host:camera-participant", { userId: data.userId, cameraOff: Boolean(data.cameraOff) });
      toast.success(data.cameraOff ? "Camera turned off." : "Camera turned on.");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleMuteAll = async () => {
    try {
      const res = await fetch(`/api/rooms/${token}/mute-all`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't mute everyone.");
      setParticipants((prev) => prev.map((p) => p.isHost ? p : { ...p, isMuted: true }));
      emitHostControl("host:mute-all", { userIds: Array.isArray(data.muted) ? data.muted : [], muted: true });
      toast.success("Muted everyone.");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleUnmuteAll = async () => {
    try {
      const res = await fetch(`/api/rooms/${token}/unmute-all`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't unmute everyone.");
      setParticipants((prev) => prev.map((p) => p.isHost ? p : { ...p, isMuted: false }));
      emitHostControl("host:mute-all", { userIds: Array.isArray(data.unmuted) ? data.unmuted : [], muted: false });
      toast.success("Allowed microphones for everyone.");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleCameraOffAll = async () => {
    try {
      const res = await fetch(`/api/rooms/${token}/camera-off-all`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't turn off everyone's camera.");
      setParticipants((prev) => prev.map((p) => p.isHost ? p : { ...p, isCameraOff: true }));
      emitHostControl("host:camera-all", { userIds: Array.isArray(data.camerasOff) ? data.camerasOff : [], cameraOff: true });
      toast.success("Turned off everyone's camera.");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleCameraOnAll = async () => {
    try {
      const res = await fetch(`/api/rooms/${token}/camera-on-all`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't turn on everyone's camera.");
      setParticipants((prev) => prev.map((p) => p.isHost ? p : { ...p, isCameraOff: false }));
      emitHostControl("host:camera-all", { userIds: Array.isArray(data.camerasOn) ? data.camerasOn : [], cameraOff: false });
      toast.success("Allowed cameras for everyone.");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleAdmit = async (requestId: number) => {
    // Deliberately NOT removed from local state until the request
    // actually succeeds — removing it optimistically meant that any
    // failed admit call left the card gone locally while the request
    // was still PENDING in the database, and the join-request polling
    // fallback (see the effect above) would then re-discover it as a
    // "new" request a few seconds later, reappearing indefinitely
    // even though nothing had actually changed. Keeping the card
    // visible until success is confirmed means a failure just shows an
    // error and lets the host retry, instead of a confusing
    // disappear-then-reappear loop.
    try {
      const res = await fetch(`/api/rooms/${token}/join-requests/${requestId}/admit`, { method: "POST", headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't admit that person.");
        return;
      }
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleDeny = async (requestId: number) => {
    // Same reasoning as handleAdmit above.
    try {
      const res = await fetch(`/api/rooms/${token}/join-requests/${requestId}/deny`, { method: "POST", headers: authHeaders() });
      if (!res.ok) {
        toast.error("Couldn't deny that request. Check your connection and try again.");
        return;
      }
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleInvite = async () => {
    const emails = inviteInput
      .split(/[,\s]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/rooms/${token}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ emails }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't send that invite.");
        return;
      }
      if (data.emailsFailed?.length) {
        toast.warning(
          `Added to the invite list, but the email didn't send for: ${data.emailsFailed.join(", ")}. Check the backend terminal for the SMTP error, or share the link with them directly.`,
        );
      } else {
        toast.success(emails.length === 1 ? "Invited." : `Invited ${emails.length} people.`);
      }
      setInviteInput("");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveParticipant = async (userId: number) => {
    const target = participants.find((participant) => participant.userId === userId);
    if (!(await confirmToast(`Remove ${target?.name ?? "this participant"} from the meeting?`, "Remove"))) return;
    try {
      const res = await fetch(`/api/rooms/${token}/participants/${userId}/remove`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't remove that participant.");
      toast.success("Participant removed.");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleToggleLock = async () => {
    const next = !locked;
    try {
      const res = await fetch(`/api/rooms/${token}/lock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ locked: next }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't change meeting access.");
      setLocked(next);
      toast.success(next ? "Meeting locked — new participants can't join." : "Meeting unlocked.");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleSetPasscode = async () => {
    const input = window.prompt(
      passcodeSet
        ? "Change the meeting passcode (leave blank to remove it):"
        : "Set a meeting passcode (at least 4 characters):",
    );
    if (input === null) return; // cancelled
    try {
      const res = await fetch(`/api/rooms/${token}/passcode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ passcode: input.trim() === "" ? null : input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't update the passcode.");
      setPasscodeSet(data.meeting.passcodeSet);
      toast.success(data.meeting.passcodeSet ? "Passcode set." : "Passcode removed.");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleEndMeeting = async () => {
    if (!(await confirmToast("End this meeting for everyone?", "End for everyone"))) return;
    setEnding(true);
    try {
      const res = await fetch(`/api/rooms/${token}/end`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Couldn't end the meeting.");
      toast.success("Meeting ended for everyone.");
      exitMeeting("ended");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setEnding(false);
    }
  };

  const setActivePanel = (next: Panel) => setPanel((current) => (current === next ? null : next));

  const myRow = participants.find((participant) => participant.userId === me?.id);
  const others = participants.filter((participant) => participant.userId !== me?.id && !participant.leftAt);
  const liveByUserId = useMemo(() => new Map(peers.map((peer) => [peer.userId, peer])), [peers]);
  const totalTiles = others.length + 1;
  const spotlightFeatured = others.find((p) => p.isHost) ?? others[0] ?? null;
  // Whoever's screen should be the big tile right now — either mine, or
  // the first other participant currently sharing theirs. Meet only ever
  // shows one screen share at a time in practice, so "first" is fine.
  const remotePresenter = others.find(
    (participant) => liveByUserId.get(participant.userId)?.screenStream,
  );
  const presentingStream = sharingScreen
    ? screenStream
    : remotePresenter
      ? (liveByUserId.get(remotePresenter.userId)?.screenStream ?? null)
      : null;
  const presentingName = sharingScreen ? "Your screen" : remotePresenter ? `${remotePresenter.name}'s screen` : "";
  const activeParticipantCount = others.length + 1;

  if (checkingAuth || !me) {
    return <LoadingScreen message="Loading..." />;
  }

  if (!hostCheckDone) {
    return <LoadingScreen message="Joining meeting..." />;
  }

  if (!joined && !isHost) {
    return (
      <div className="relative flex h-dvh flex-col overflow-hidden bg-[#0f1012] text-white">
        <header className="flex items-center justify-between px-6 py-5 sm:px-10">
          <BrandLink size={22} />
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-10 sm:flex-row sm:gap-12">
          <div className="relative h-[280px] w-full max-w-xl overflow-hidden rounded-2xl bg-[#171A21] sm:h-[360px]">
            <VideoTile
              name={me.name ?? me.email}
              isMuted={!micOn}
              cameraOn={cameraOn}
              stream={localStream}
              isLocal
              mirrored
            />
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
              <button
                onClick={toggleMic}
                aria-label={micOn ? "Turn off microphone" : "Turn on microphone"}
                className={`flex h-11 w-11 items-center justify-center rounded-full ${micOn ? "bg-white/10 hover:bg-white/15" : "bg-[#ea4335] hover:bg-[#d93025]"}`}
              >
                {micOn ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
              <button
                onClick={toggleCamera}
                aria-label={cameraOn ? "Turn off camera" : "Turn on camera"}
                className={`flex h-11 w-11 items-center justify-center rounded-full ${cameraOn ? "bg-white/10 hover:bg-white/15" : "bg-[#ea4335] hover:bg-[#d93025]"}`}
              >
                {cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
            </div>
          </div>

          <div className="flex w-full max-w-sm flex-col items-center text-center sm:items-start sm:text-left">
            <h1 className="font-display text-2xl font-semibold">
              {waitingForAdmission ? "Asking to join..." : "Ready to join?"}
            </h1>
            <p className="mt-1 text-sm text-white/50">{token}</p>
            {waitingForAdmission ? (
              <p className="mt-6 text-sm text-white/60">
                Waiting for the host to let you in. This page will move on automatically once
                they respond.
              </p>
            ) : (
              <button
                onClick={() => void handleJoinFromLobby()}
                disabled={joining}
                className="mt-6 rounded-full bg-accent px-8 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {joining ? "Joining..." : "Join now"}
              </button>
            )}
          </div>
        </main>
        {showReadyCard && (
          <ReadyMeetingCard token={token} inviteInput={inviteInput} setInviteInput={setInviteInput} inviting={inviting} handleInvite={handleInvite} linkCopied={linkCopied} setLinkCopied={setLinkCopied} onClose={() => setShowReadyCard(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="relative h-dvh overflow-hidden bg-[#0f1012] text-white">
      <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-sm font-medium text-white sm:text-base">{formatTime(now)}</span>
          <span className="text-white/35">|</span>
          <span className="max-w-[180px] truncate text-sm font-medium text-white/85 sm:max-w-none">{token}</span>
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} title={connected ? "Connected" : "Connecting"} />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {sharingScreen && (
            <div className="flex items-center gap-2 rounded-full bg-white/[0.06] pl-3 pr-1 py-1">
              <span className="text-xs font-medium text-white/85">You&apos;re presenting</span>
              <button
                onClick={handleScreenShareClick}
                className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Stop presenting
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full bg-white/[0.06] pl-1.5 pr-2.5 py-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">{initials(me.name ?? me.email)}</div>
            <span className="text-xs font-medium text-white/75">{activeParticipantCount}</span>
          </div>
        </div>
      </header>

      <main className="absolute inset-x-0 top-16 bottom-24 overflow-hidden bg-[#0f1012] px-4 py-4 sm:top-20 sm:bottom-28 sm:px-8 sm:py-6">
        {presentingStream ? (
          <>
            {/* Full-bleed shared screen — no padding, no rounding, matching Meet exactly. */}
            <VideoTile name={presentingName} cameraOn stream={presentingStream} rounded={false} />
            {/* Floating camera thumbnails — fixed pixel size, absolutely
                positioned, intentionally NOT part of any flex/percentage-height
                chain. Earlier attempts using a flex strip for this kept
                breaking (collapsing to full size or disappearing) because
                percentage heights through several nested flex layers are
                fragile; a fixed-size floating box sidesteps that entirely.
                Shows everyone's camera — including the presenter's own,
                and mine, regardless of who's presenting — matching Meet,
                which keeps every camera visible as a small tile even
                while someone's screen is the main view. */}
            <div
              className="absolute bottom-4 right-4 z-10 h-28 w-44 overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10 sm:h-32 sm:w-52"
            >
              <VideoTile
                name={`${me.name ?? me.email} (You)`}
                isHost={myRow?.isHost ?? false}
                isMuted={!micOn}
                cameraOn={cameraOn}
                stream={localStream}
                isLocal
                mirrored
                handRaised={handRaised}
              />
            </div>
            {others.slice(0, 3).map((participant, i) => {
              const live = liveByUserId.get(participant.userId);
              return (
                <div
                  key={participant.userId}
                  className="absolute z-10 h-28 w-44 overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10 sm:h-32 sm:w-52"
                  style={{ bottom: 16, right: 16 + (i + 1) * 184 }}
                >
                  <VideoTile
                    name={participant.name}
                    isHost={participant.isHost}
                    isMuted={live ? !live.micOn : participant.isMuted}
                    cameraOn={live ? live.cameraOn : false}
                    stream={live?.stream ?? null}
                    handRaised={live?.handRaised ?? false}
                  />
                </div>
              );
            })}
          </>
        ) : totalTiles === 1 ? (
          // Solo view — a real 16:9 box centered in the available space,
          // matching the camera's own requested aspect ratio (see the
          // getUserMedia call above). `h-full` gives the box an actual
          // sizing basis before aspect-ratio kicks in — without it (just
          // max-h-full/max-w-full, no base dimension), the box has nothing
          // to size itself from and collapses to fit its content instead
          // of filling the space, which is what produced a tiny
          // shrunken avatar when the camera was off.
          <div className="flex h-full w-full items-center justify-center">
            <div className="aspect-video h-full max-w-full">
              <VideoTile
                name={`${me.name ?? me.email} (You)`}
                isHost={myRow?.isHost ?? false}
                isMuted={!micOn}
                cameraOn={cameraOn}
                stream={localStream}
                isLocal
                mirrored
                handRaised={handRaised}
              />
            </div>
          </div>
        ) : layoutMode === "spotlight" ? (
          <div className="flex h-full w-full flex-col gap-2 p-2 sm:gap-3 sm:p-3">
            <div className="min-h-0 flex-1">
              {spotlightFeatured ? (
                (() => {
                  const live = liveByUserId.get(spotlightFeatured.userId);
                  return (
                    <VideoTile
                      name={spotlightFeatured.name}
                      isHost={spotlightFeatured.isHost}
                      isMuted={live ? !live.micOn : spotlightFeatured.isMuted}
                      cameraOn={live ? live.cameraOn : false}
                      stream={live?.stream ?? null}
                      handRaised={live?.handRaised ?? false}
                    />
                  );
                })()
              ) : (
                <VideoTile
                  name={`${me.name ?? me.email} (You)`}
                  isHost={myRow?.isHost ?? false}
                  isMuted={!micOn}
                  cameraOn={cameraOn}
                  stream={localStream}
                  isLocal
                  mirrored
                  handRaised={handRaised}
                />
              )}
            </div>
            <div className="flex h-20 shrink-0 gap-2 overflow-x-auto sm:h-24 sm:gap-3">
              {spotlightFeatured && (
                <div className="aspect-video h-full shrink-0">
                  <VideoTile
                    name={`${me.name ?? me.email} (You)`}
                    isHost={myRow?.isHost ?? false}
                    isMuted={!micOn}
                    cameraOn={cameraOn}
                    stream={localStream}
                    isLocal
                    mirrored
                    handRaised={handRaised}
                  />
                </div>
              )}
              {others
                .filter((participant) => participant.userId !== spotlightFeatured?.userId)
                .map((participant) => {
                  const live = liveByUserId.get(participant.userId);
                  return (
                    <div key={participant.userId} className="aspect-video h-full shrink-0">
                      <VideoTile
                        name={participant.name}
                        isHost={participant.isHost}
                        isMuted={live ? !live.micOn : participant.isMuted}
                        cameraOn={live ? live.cameraOn : false}
                        stream={live?.stream ?? null}
                        handRaised={live?.handRaised ?? false}
                      />
                    </div>
                  );
                })}
            </div>
          </div>
        ) : (
          <div
            className={`grid h-full w-full auto-rows-fr gap-2 p-2 sm:gap-3 sm:p-3 ${totalTiles === 2 ? "grid-cols-1 md:grid-cols-2" : totalTiles <= 4 ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-3"
              }`}
          >
            <VideoTile
              name={`${me.name ?? me.email} (You)`}
              isHost={myRow?.isHost ?? false}
              isMuted={!micOn}
              cameraOn={cameraOn}
              stream={localStream}
              isLocal
              mirrored
              handRaised={handRaised}
            />
            {others.map((participant) => {
              const live = liveByUserId.get(participant.userId);
              return (
                <VideoTile
                  key={participant.userId}
                  name={participant.name}
                  isHost={participant.isHost}
                  isMuted={live ? !live.micOn : participant.isMuted}
                  cameraOn={live ? live.cameraOn : false}
                  stream={live?.stream ?? null}
                  handRaised={live?.handRaised ?? false}
                />
              );
            })}
          </div>
        )}

        {captionsOn && (
          <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 sm:bottom-28">
            {captionText ? (
              <div className="max-w-2xl rounded-lg bg-black/85 px-5 py-3 shadow-xl">
                <p className="text-xs font-semibold text-accent">{me.name ?? me.email}</p>
                <p className="text-base text-white">{captionText}</p>
              </div>
            ) : (
              <p className="rounded-lg bg-black/60 px-4 py-2 text-sm text-white/70 shadow-xl">
                Captions on — listening for speech...
              </p>
            )}
          </div>
        )}

        {timerRemaining !== null && (
          <div className="absolute right-4 top-4 z-20 rounded-full bg-black/60 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
            {Math.floor(timerRemaining / 60)}:{String(timerRemaining % 60).padStart(2, "0")}
          </div>
        )}
      </main>

      {menuOpen && (
        <div className="absolute bottom-24 left-1/2 z-40 w-72 -translate-x-1/2 rounded-2xl border border-white/10 bg-[#202124] p-2 shadow-2xl sm:bottom-24">
          {myRow?.isHost && (
            <>
              <button onClick={() => { void handleToggleLock(); setMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/10">
                {locked ? <LockOpen size={18} /> : <Lock size={18} />}
                <span>{locked ? "Unlock meeting" : "Lock meeting"}</span>
              </button>
              <button onClick={() => { void handleSetPasscode(); setMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/10">
                <KeyRound size={18} />
                <span>{passcodeSet ? "Change passcode" : "Set a passcode"}</span>
              </button>
              <button onClick={() => { void handleEndMeeting(); setMenuOpen(false); }} disabled={ending} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-60">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs">×</span>
                <span>{ending ? "Ending meeting…" : "End meeting for everyone"}</span>
              </button>
            </>
          )}
          <button
            onClick={() => {
              toggleCaptions();
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/10"
          >
            <Captions size={18} />
            <span>{captionsOn ? "Turn off captions" : "Turn on captions"}</span>
          </button>

          {/* Mobile-only — on larger screens these three already have
              their own dedicated buttons (hand raise in the main pill,
              chat/tools in the bottom-right utility strip), so showing
              them here too would just be a redundant duplicate. Below
              those breakpoints, this menu is the only way to reach
              them — without this they'd have been genuinely
              unreachable, not just relocated. */}
          <button
            onClick={() => {
              handleToggleHandRaise();
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/10 sm:hidden"
          >
            <Hand size={18} />
            <span>{handRaised ? "Lower hand" : "Raise hand"}</span>
          </button>
          <button
            onClick={() => {
              setActivePanel("chat");
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/10 md:hidden"
          >
            <MessageSquare size={18} />
            <span>Chat</span>
          </button>
          <button
            onClick={() => {
              setActivePanel("tools");
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/10 md:hidden"
          >
            <LayoutGrid size={18} />
            <span>Meeting tools</span>
          </button>
        </div>
      )}

      {pendingRequests.length > 0 && (
        <div className="absolute right-4 top-16 z-30 w-full max-w-xs space-y-2 sm:top-20">
          {pendingRequests.map((request) => (
            <div key={request.id} className="rounded-2xl bg-[#202124] p-4 text-white shadow-2xl">
              <p className="text-sm">
                <span className="font-semibold">{request.name}</span> wants to join
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleDeny(request.id)}
                  className="flex-1 rounded-full px-3 py-2 text-xs font-medium text-white/70 hover:bg-white/10"
                >
                  Deny
                </button>
                <button
                  onClick={() => handleAdmit(request.id)}
                  className="flex-1 rounded-full bg-accent px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                >
                  Admit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showReadyCard && (
        <ReadyMeetingCard token={token} inviteInput={inviteInput} setInviteInput={setInviteInput} inviting={inviting} handleInvite={handleInvite} linkCopied={linkCopied} setLinkCopied={setLinkCopied} onClose={() => setShowReadyCard(false)} />
      )}

      {showShareWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#202124] p-6 text-white shadow-2xl">
            <h2 className="text-lg font-medium">Before you share...</h2>
            <p className="mt-2 text-sm text-white/70">
              Don&apos;t share your entire screen or this browser tab — sharing the tab this
              meeting is running in creates an infinite mirror (your shared screen showing
              itself, showing itself...). Share a different window or tab instead.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowShareWarning(false)}
                className="rounded-full px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={startScreenShare}
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}

      <ControlBar
        micOn={micOn}
        cameraOn={cameraOn}
        micLocked={micLocked}
        cameraLocked={cameraLocked}
        participantsOpen={panel === "people"}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onToggleParticipants={() => setActivePanel("people")}
        onScreenShareClick={handleScreenShareClick}
        sharingScreen={sharingScreen}
        handRaised={handRaised}
        onToggleHandRaise={handleToggleHandRaise}
        onReact={handleReact}
        captionsOn={captionsOn}
        onToggleCaptions={toggleCaptions}
        onMoreClick={() => setMenuOpen((value) => !value)}
        onLeave={handleLeave}
        leaving={leaving || ending}
        onChat={() => setActivePanel("chat")}
        onTools={() => setActivePanel("tools")}
      />

      {reactions.length > 0 && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1">
          {reactions.map((r) => (
            <div
              key={r.id}
              className="animate-[float-up_3s_ease-out_forwards] rounded-full bg-black/40 px-3 py-1 text-sm text-white backdrop-blur"
            >
              <span className="mr-1.5 text-lg">{r.emoji}</span>
              {r.fromName}
            </div>
          ))}
        </div>
      )}

      <MeetingPanel
        panel={panel}
        participants={participants}
        viewerIsHost={myRow?.isHost ?? false}
        onClose={() => setPanel(null)}
        onMute={handleMuteParticipant}
        onCameraOff={handleCameraOffParticipant}
        onRemove={handleRemoveParticipant}
        onMuteAll={handleMuteAll}
        onUnmuteAll={handleUnmuteAll}
        onCameraOffAll={handleCameraOffAll}
        onCameraOnAll={handleCameraOnAll}
        pendingRequests={pendingRequests}
        onAdmit={handleAdmit}
        onDeny={handleDeny}
        message={message}
        setMessage={setMessage}
        captionsOn={captionsOn}
        onToggleCaptions={toggleCaptions}
        layoutMode={layoutMode}
        onCycleLayout={cycleLayout}
        timerRemaining={timerRemaining}
        onStartTimer={startTimer}
        onStopTimer={stopTimer}
        chatMessages={chatMessages}
        onSendChat={sendChatMessage}
        myUserId={me.id}
      />

    </div>
  );
}
