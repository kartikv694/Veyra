"use client";

import { Crown, Mic, MicOff, UserX, Video, VideoOff, X } from "lucide-react";

export interface ParticipantRow {
  userId: number;
  name: string;
  isHost: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  leftAt: string | null;
}

interface ParticipantListProps {
  open: boolean;
  participants: ParticipantRow[];
  onClose: () => void;
  viewerIsHost: boolean;
  onMute?: (userId: number) => void;
  onCameraOff?: (userId: number) => void;
  onRemove?: (userId: number) => void;
  onMuteAll?: () => void;
  onCameraOffAll?: () => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ParticipantList({
  open,
  participants,
  onClose,
  viewerIsHost,
  onMute,
  onCameraOff,
  onRemove,
  onMuteAll,
  onCameraOffAll,
}: ParticipantListProps) {
  if (!open) return null;

  const active = participants.filter((p) => !p.leftAt);
  const departed = participants.filter((p) => p.leftAt);
  const othersActive = active.filter((p) => !p.isHost);
  const anyoneUnmuted = othersActive.some((p) => !p.isMuted);
  const anyoneCameraOn = othersActive.some((p) => !p.isCameraOff);

  return (
    <aside className="flex h-full w-full flex-col bg-[#202124] text-white">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-xl font-medium">People</h2>
        <button
          onClick={onClose}
          aria-label="Close participant panel"
          className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <X size={20} />
        </button>
      </div>

      <div className="px-5 pb-3 text-sm text-white/60">{active.length} in this meeting</div>

      {viewerIsHost && othersActive.length > 0 && (
        <div className="flex gap-2 px-5 pb-3">
          <button
            onClick={onMuteAll}
            disabled={!anyoneUnmuted}
            className="flex-1 rounded-full border border-white/15 px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-40"
          >
            Mute all
          </button>
          <button
            onClick={onCameraOffAll}
            disabled={!anyoneCameraOn}
            className="flex-1 rounded-full border border-white/15 px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-40"
          >
            Turn off all cameras
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {active.map((p) => (
          <div
            key={p.userId}
            className="group flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-white/5"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold">
              {initials(p.name)}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{p.name}</span>
                {p.isHost && <Crown size={13} className="shrink-0 text-amber-300" />}
              </div>
              <span className="text-xs text-white/45">{p.isHost ? "Host" : "Participant"}</span>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {p.isMuted ? <MicOff size={17} className="text-white/55" /> : <Mic size={17} className="text-white/75" />}
              {p.isCameraOff ? <VideoOff size={17} className="text-white/55" /> : <Video size={17} className="text-white/75" />}
              {viewerIsHost && !p.isHost && (
                <div className="hidden items-center gap-1 group-hover:flex">
                  {!p.isMuted && (
                    <button
                      onClick={() => onMute?.(p.userId)}
                      aria-label={`Mute ${p.name}`}
                      title="Mute"
                      className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white"
                    >
                      <MicOff size={14} />
                    </button>
                  )}
                  {!p.isCameraOff && (
                    <button
                      onClick={() => onCameraOff?.(p.userId)}
                      aria-label={`Turn off ${p.name}'s camera`}
                      title="Turn off camera"
                      className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white"
                    >
                      <VideoOff size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => onRemove?.(p.userId)}
                    aria-label={`Remove ${p.name}`}
                    title="Remove participant"
                    className="rounded-full p-2 text-white/60 hover:bg-red-500/15 hover:text-red-300"
                  >
                    <UserX size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {departed.length > 0 && (
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-white/35">Left</p>
            {departed.map((p) => (
              <div key={p.userId} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm text-white/40">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5">
                  {initials(p.name)}
                </div>
                <span className="truncate">{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
