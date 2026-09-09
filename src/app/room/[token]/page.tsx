"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Captions,
  Grid3X3,
  Info,
  KeyRound,
  Languages,
  Lock,
  LockOpen,
  MessageSquare,
  Send,
  Timer,
  X,
} from "lucide-react";
import { toast, confirmToast } from "@/lib/toast";
import { VideoTile } from "@/components/VideoTile";
import { ControlBar } from "@/components/ControlBar";
import { ParticipantList, type ParticipantRow } from "@/components/ParticipantList";
import { checkAuth, authHeaders, type SessionUser } from "@/lib/auth-client";
import { useMeetingRoom } from "@/hooks/useMeetingRoom";

const ROSTER_POLL_MS = 8000;

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

function MeetingPanel({
  panel,
  participants,
  viewerIsHost,
  onClose,
  onMute,
  onRemove,
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
  onRemove: (userId: number) => void;
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
    <aside className="absolute inset-y-2 right-2 z-30 flex w-[min(360px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl bg-[#202124] shadow-2xl ring-1 ring-white/10 sm:inset-y-3 sm:right-3">
      {panel === "people" && (
        <ParticipantList
          open
          participants={participants}
          onClose={onClose}
          viewerIsHost={viewerIsHost}
          onMute={onMute}
          onRemove={onRemove}
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
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                        isMine ? "bg-accent text-white" : "bg-[#2b2c30] text-white/90"
                      }`}
                    >
                      {msg.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-white/10 p-4">
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
                  className={`rounded-2xl border p-4 text-left transition ${
                    captionsOn ? "border-accent bg-accent/10 text-white" : "border-white/10 text-white/55 hover:bg-white/5"
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
  const [me, setMe] = useState<SessionUser | null>(null);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [message, setMessage] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [locked, setLocked] = useState(false);
  const [passcodeSet, setPasscodeSet] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [showShareWarning, setShowShareWarning] = useState(false);
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

  const { peers, connected, broadcastMediaState, replaceVideoTrack, broadcastHandRaise, sendReaction, sendChatMessage } = useMeetingRoom(
    token,
    localStream,
    me?.id ?? null,
    {
      onForceMuted: () => {
        streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = false));
        setMicOn(false);
        toast.info("The host muted you.");
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
  );

  const loadRoster = useCallback(async () => {
    const res = await fetch(`/api/rooms/${token}`, { headers: authHeaders() });
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) {
        toast.error("You're no longer in this meeting.");
        exitMeeting("left");
      }
      return;
    }
    const data = await res.json();
    setParticipants(data.participants);
    setLocked(Boolean(data.meeting.locked));
    setPasscodeSet(Boolean(data.meeting.passcodeSet));
    if (data.meeting.endAt) {
      exitMeeting("ended");
    }
  }, [token, exitMeeting]);

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
        router.push("/login");
        return;
      }
      setMe(user);
      setCheckingAuth(false);
      await loadRoster();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setLocalStream(stream);
      } catch {
        setCameraOn(false);
        setMicOn(false);
        toast.warning("Camera or microphone access was unavailable. You can still join the meeting.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (checkingAuth) return;
    const id = setInterval(loadRoster, ROSTER_POLL_MS);
    return () => clearInterval(id);
  }, [checkingAuth, loadRoster]);

  const toggleMic = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach((track) => (track.enabled = next));
    setMicOn(next);
    broadcastMediaState(next, cameraOn);
  };

  const toggleCamera = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !cameraOn;
    stream.getVideoTracks().forEach((track) => (track.enabled = next));
    setCameraOn(next);
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
      if (recognitionRef.current) recognition.start();
    };
    recognition.start();
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
    if (connected) broadcastMediaState(micOn, cameraOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerCount, connected]);

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setSharingScreen(false);
    setScreenStream(null);
    const cameraTrack = streamRef.current?.getVideoTracks()[0] ?? null;
    replaceVideoTrack(cameraTrack);
    broadcastMediaState(micOn, cameraOn);
  }, [replaceVideoTrack, broadcastMediaState, micOn, cameraOn]);

  const startScreenShare = async () => {
    setShowShareWarning(false);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = display.getVideoTracks()[0];
      screenStreamRef.current = display;
      setSharingScreen(true);
      setScreenStream(display);
      replaceVideoTrack(screenTrack);
      // Treat sharing as "video on" for everyone else regardless of the
      // actual camera toggle, so their tile renders the shared frames
      // instead of falling back to the avatar.
      broadcastMediaState(micOn, true);
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
      toast.success("Participant muted.");
      await loadRoster();
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
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
      await loadRoster();
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
  const activeParticipantCount = others.length + 1;

  if (checkingAuth || !me) return <div className="min-h-screen bg-[#0f1012]" />;

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

      <main className="absolute inset-x-0 top-16 bottom-24 overflow-hidden bg-black sm:top-20 sm:bottom-28">
        {sharingScreen ? (
          <>
            {/* Full-bleed shared screen — no padding, no rounding, matching Meet exactly. */}
            <VideoTile
              name="Screen share"
              cameraOn
              stream={screenStream}
              isLocal
              rounded={false}
            />
            {/* Floating self-camera thumbnail — fixed pixel size, absolutely
                positioned, intentionally NOT part of any flex/percentage-height
                chain. Earlier attempts using a flex strip for this kept
                breaking (collapsing to full size or disappearing) because
                percentage heights through several nested flex layers are
                fragile; a fixed-size floating box sidesteps that entirely. */}
            <div className="absolute bottom-4 right-4 z-10 h-28 w-44 overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10 sm:h-32 sm:w-52">
              <VideoTile
                name={`${me.name ?? me.email} (You)`}
                isHost={myRow?.isHost ?? false}
                isMuted={!micOn}
                cameraOn={cameraOn}
                stream={localStream}
                isLocal
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
          // Solo view — full-bleed, matching Meet's own edge-to-edge look
          // when it's just you in the call.
          <VideoTile
            name={`${me.name ?? me.email} (You)`}
            isHost={myRow?.isHost ?? false}
            isMuted={!micOn}
            cameraOn={cameraOn}
            stream={localStream}
            isLocal
            handRaised={handRaised}
            rounded={false}
          />
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
            className={`grid h-full w-full auto-rows-fr gap-2 p-2 sm:gap-3 sm:p-3 ${
              totalTiles === 2 ? "grid-cols-1 md:grid-cols-2" : totalTiles <= 4 ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-3"
            }`}
          >
            <VideoTile
              name={`${me.name ?? me.email} (You)`}
              isHost={myRow?.isHost ?? false}
              isMuted={!micOn}
              cameraOn={cameraOn}
              stream={localStream}
              isLocal
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
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 w-full max-w-2xl -translate-x-1/2 px-4">
            {captionText ? (
              <div className="rounded-lg bg-black/75 px-4 py-2.5 backdrop-blur">
                <p className="text-xs font-semibold text-accent">{me.name ?? me.email}</p>
                <p className="text-sm text-white">{captionText}</p>
              </div>
            ) : (
              <p className="text-center text-xs text-white/40">Listening for speech...</p>
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
        </div>
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
        participantsOpen={panel === "people"}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onToggleParticipants={() => setActivePanel("people")}
        onScreenShareClick={handleScreenShareClick}
        sharingScreen={sharingScreen}
        handRaised={handRaised}
        onToggleHandRaise={handleToggleHandRaise}
        onReact={handleReact}
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
        onRemove={handleRemoveParticipant}
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
