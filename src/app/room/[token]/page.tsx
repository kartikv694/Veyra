"use client";

/**
 * /room/[token] — the meeting room screen.
 *
 * Two data sources feed this page, deliberately kept separate:
 *   - The DB roster (GET /api/rooms/[token], polled periodically) is the
 *     durable "who's actually a participant" list — used for the
 *     participant panel, host badges, and detecting when the meeting ends.
 *   - `useMeetingRoom` (Socket.IO signaling + WebRTC) is the live,
 *     ephemeral layer — who's actually connected *right now* and their
 *     real audio/video streams. A roster entry without a live peer yet
 *     just means their connection hasn't finished negotiating.
 *
 * Auth-guarded like /dashboard: checkAuth() must succeed before anything
 * renders, and GET /api/rooms/[token] independently confirms the caller is
 * actually a participant in *this* meeting (not just logged in generally).
 * The socket connection re-verifies this same thing server-side (see
 * server.ts) — a valid page load doesn't imply a valid socket connection.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { VideoTile } from "@/components/VideoTile";
import { ControlBar } from "@/components/ControlBar";
import { ParticipantList, type ParticipantRow } from "@/components/ParticipantList";
import { checkAuth, authHeaders, type SessionUser } from "@/lib/auth-client";
import { useMeetingRoom } from "@/hooks/useMeetingRoom";

const ROSTER_POLL_MS = 8000;

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
  const [participantsOpen, setParticipantsOpen] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);

  // The real-time layer: Socket.IO signaling + a WebRTC peer connection per
  // other participant currently connected. `participants` (below) is the
  // durable DB roster used for the panel and host badges; `peers` is the
  // live, ephemeral set of who's actually connected right now, with real
  // media streams once each connection completes.
  const { peers, connected, broadcastMediaState } = useMeetingRoom(token, localStream);

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
    if (data.meeting.endAt) {
      toast.info("This meeting has ended.");
      router.push("/dashboard");
    }
  }, [token, router]);

  // Auth guard, then acquire local camera/mic and start polling the roster.
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
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setLocalStream(stream);
      } catch {
        // No camera/mic permission — fall back to the avatar tile silently;
        // toggling mic/camera below just no-ops without a stream.
        setCameraOn(false);
        setMicOn(false);
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
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
    stream.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
    broadcastMediaState(next, cameraOn);
  };

  const toggleCamera = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !cameraOn;
    stream.getVideoTracks().forEach((t) => (t.enabled = next));
    setCameraOn(next);
    broadcastMediaState(micOn, next);
  };

  // A newly-connected peer has no way of knowing our mic/camera state until
  // we tell them — re-announce it whenever the live peer set grows.
  const peerCount = peers.length;
  useEffect(() => {
    if (connected) broadcastMediaState(micOn, cameraOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerCount, connected]);

  const handleScreenShareClick = () => {
    toast.info("Screen sharing arrives in a later task.");
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      toast.success("You left the meeting.");
      router.push("/dashboard");
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLeaving(false);
    }
  };

  if (checkingAuth || !me) {
    return <div className="min-h-screen bg-[#0F1115]" />;
  }

  const others = participants.filter((p) => p.userId !== me.id && !p.leftAt);
  const myRow = participants.find((p) => p.userId === me.id);
  const liveByUserId = new Map(peers.map((p) => [p.userId, p]));

  return (
    <div className="flex h-screen flex-col bg-[#0F1115] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <div className="flex items-center gap-2">
          <BrandMark size={20} />
          <span className="font-display text-sm font-semibold">Veyra</span>
          <span className="ml-3 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/60">{token}</span>
          <span
            className={`ml-1 h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-white/20"}`}
            title={connected ? "Connected" : "Connecting..."}
          />
        </div>
        <ThemeToggle />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <VideoTile
              name={`${me.name ?? me.email} (You)`}
              isHost={myRow?.isHost ?? false}
              isMuted={!micOn}
              cameraOn={cameraOn}
              stream={localStream}
            />
            {others.map((p) => {
              const live = liveByUserId.get(p.userId);
              return (
                <VideoTile
                  key={p.userId}
                  name={p.name}
                  isHost={p.isHost}
                  isMuted={live ? !live.micOn : p.isMuted}
                  cameraOn={live ? live.cameraOn : false}
                  stream={live?.stream ?? null}
                />
              );
            })}
          </div>
        </main>

        <ParticipantList
          open={participantsOpen}
          participants={participants}
          onClose={() => setParticipantsOpen(false)}
        />
      </div>

      <ControlBar
        micOn={micOn}
        cameraOn={cameraOn}
        participantsOpen={participantsOpen}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onToggleParticipants={() => setParticipantsOpen((v) => !v)}
        onScreenShareClick={handleScreenShareClick}
        onLeave={handleLeave}
        leaving={leaving}
      />
    </div>
  );
}
