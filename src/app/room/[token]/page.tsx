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
  Smile,
  Timer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { VideoTile } from "@/components/VideoTile";
import { ControlBar } from "@/components/ControlBar";
import { ParticipantList, type ParticipantRow } from "@/components/ParticipantList";
import { checkAuth, authHeaders, type SessionUser } from "@/lib/auth-client";
import { useMeetingRoom } from "@/hooks/useMeetingRoom";

const ROSTER_POLL_MS = 8000;

type Panel = "people" | "chat" | "tools" | null;

function confirmToast(message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean, id: string | number) => {
      if (settled) return;
      settled = true;
      toast.dismiss(id);
      resolve(value);
    };
    const id = toast(message, {
      duration: Infinity,
      action: { label: confirmLabel, onClick: () => finish(true, id) },
      cancel: { label: "Cancel", onClick: () => finish(false, id) },
      onDismiss: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
  });
}

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
}: {
  panel: Panel;
  participants: ParticipantRow[];
  viewerIsHost: boolean;
  onClose: () => void;
  onMute: (userId: number) => void;
  onRemove: (userId: number) => void;
  message: string;
  setMessage: (value: string) => void;
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
          <div className="flex flex-1 flex-col justify-between p-4">
            <div className="rounded-xl bg-[#2b2c30] p-4 text-sm text-white/75">
              <div className="mb-2 flex items-center gap-2 font-medium text-white">
                <MessageSquare size={16} />
                Meeting chat
              </div>
              <p className="leading-6 text-white/55">
                Send a message to people in this meeting. Chat delivery can be connected to Socket.IO when the messaging feature is enabled.
              </p>
            </div>

            <div className="rounded-full border border-white/15 bg-[#1a1b1e] px-4 py-2">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!message.trim()) return;
                  toast.success("Message UI is ready; realtime chat is not enabled yet.");
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
                <button type="button" aria-label="Add reaction" className="rounded-full p-1.5 text-white/50 hover:text-white">
                  <Smile size={18} />
                </button>
                <button type="submit" aria-label="Send message" className="rounded-full p-1.5 text-white/50 hover:text-white">
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
              <button className="flex w-full items-center gap-4 rounded-2xl bg-[#2b2c30] p-4 text-left transition hover:bg-[#34353a]">
                <Languages className="text-violet-300" size={21} />
                <span className="flex-1"><strong className="block text-sm font-medium">Speech translation</strong><small className="text-white/45">Translate spoken audio</small></span>
                <span className="text-white/35">›</span>
              </button>
              <button className="flex w-full items-center gap-4 rounded-2xl bg-[#2b2c30] p-4 text-left transition hover:bg-[#34353a]">
                <Timer className="text-purple-300" size={21} />
                <span className="flex-1"><strong className="block text-sm font-medium">Timer</strong><small className="text-white/45">Show a countdown timer</small></span>
                <span className="text-white/35">›</span>
              </button>
              <div className="pt-4 text-xs font-semibold uppercase tracking-wider text-white/35">More tools</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 p-4 text-white/55"><Captions size={19} className="mb-3" /><span className="text-sm">Captions</span></div>
                <div className="rounded-2xl border border-white/10 p-4 text-white/55"><Grid3X3 size={19} className="mb-3" /><span className="text-sm">Layout</span></div>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const exitToDashboard = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    router.push("/dashboard");
  }, [router]);

  const { peers, connected, broadcastMediaState, replaceVideoTrack } = useMeetingRoom(token, localStream, me?.id ?? null, {
    onForceMuted: () => {
      streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = false));
      setMicOn(false);
      toast.info("The host muted you.");
    },
    onRemoved: () => {
      toast.error("You were removed from the meeting by the host.");
      exitToDashboard();
    },
    onMeetingEnded: () => {
      toast.info("The host ended the meeting.");
      exitToDashboard();
    },
  });

  const loadRoster = useCallback(async () => {
    const res = await fetch(`/api/rooms/${token}`, { headers: authHeaders() });
    if (!res.ok) {
      if (res.status === 403 || res.status === 404) {
        toast.error("You're no longer in this meeting.");
        router.push("/dashboard");
      }
      return;
    }
    const data = await res.json();
    setParticipants(data.participants);
    setLocked(Boolean(data.meeting.locked));
    setPasscodeSet(Boolean(data.meeting.passcodeSet));
    if (data.meeting.endAt) {
      toast.info("This meeting has ended.");
      router.push("/dashboard");
    }
  }, [token, router]);

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

  const peerCount = peers.length;
  useEffect(() => {
    if (connected) broadcastMediaState(micOn, cameraOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerCount, connected]);

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setSharingScreen(false);
    const cameraTrack = streamRef.current?.getVideoTracks()[0] ?? null;
    replaceVideoTrack(cameraTrack);
    broadcastMediaState(micOn, cameraOn);
  }, [replaceVideoTrack, broadcastMediaState, micOn, cameraOn]);

  const handleScreenShareClick = async () => {
    if (sharingScreen) {
      stopScreenShare();
      toast.info("Stopped sharing your screen.");
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = display.getVideoTracks()[0];
      screenStreamRef.current = display;
      setScreenStream(display);
      setSharingScreen(true);
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

  const handleLeave = async () => {
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
      exitToDashboard();
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
      exitToDashboard();
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
          <div className="flex items-center gap-2 rounded-full bg-white/[0.06] pl-1.5 pr-2.5 py-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">{initials(me.name ?? me.email)}</div>
            <span className="text-xs font-medium text-white/75">{activeParticipantCount}</span>
          </div>
        </div>
      </header>

      <main className="flex h-full items-center justify-center px-3 pb-20 pt-14 sm:px-5 sm:pb-24 sm:pt-16">
        <div className={`${totalTiles === 1 ? "flex w-[min(1200px,calc(100vw-24px))] max-w-[1200px] aspect-video items-center justify-center" : "grid h-[calc(100dvh-128px)] w-full auto-rows-fr gap-2 sm:gap-3"} ${
          totalTiles === 2 ? "grid-cols-1 md:grid-cols-2" : totalTiles <= 4 ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-3"
        }`}>
          <div className={totalTiles === 1 ? "h-full w-full" : "contents"}>
            <VideoTile
              name={`${me.name ?? me.email} (You)`}
              isHost={myRow?.isHost ?? false}
              isMuted={!micOn}
              cameraOn={sharingScreen ? true : cameraOn}
              stream={sharingScreen ? screenStream : localStream}
              isLocal
            />
          </div>
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
              />
            );
          })}
        </div>
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
          <button onClick={() => { handleScreenShareClick(); setMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/10"><Captions size={18} /><span>More meeting options</span></button>
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
        onMoreClick={() => setMenuOpen((value) => !value)}
        onLeave={handleLeave}
        leaving={leaving}
        onChat={() => setActivePanel("chat")}
        onTools={() => setActivePanel("tools")}
      />

      <MeetingPanel
        panel={panel}
        participants={participants}
        viewerIsHost={myRow?.isHost ?? false}
        onClose={() => setPanel(null)}
        onMute={handleMuteParticipant}
        onRemove={handleRemoveParticipant}
        message={message}
        setMessage={setMessage}
      />

    </div>
  );
}
