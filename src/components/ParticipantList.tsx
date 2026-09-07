"use client";

/**
 * Slide-over panel listing everyone in the meeting (SRS: "Display ...
 * participant list"). Pure presentation — the room page owns fetching and
 * refreshing the underlying data.
 */
import { X, MicOff, Crown } from "lucide-react";

export interface ParticipantRow {
  userId: number;
  name: string;
  isHost: boolean;
  isMuted: boolean;
  leftAt: string | null;
}

interface ParticipantListProps {
  open: boolean;
  participants: ParticipantRow[];
  onClose: () => void;
}

export function ParticipantList({ open, participants, onClose }: ParticipantListProps) {
  if (!open) return null;

  const active = participants.filter((p) => !p.leftAt);
  const departed = participants.filter((p) => p.leftAt);

  return (
    <aside className="flex w-72 flex-col border-l border-white/10 bg-[#171A21] text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold">Participants ({active.length})</h2>
        <button onClick={onClose} aria-label="Close participant list" className="text-white/50 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {active.map((p) => (
          <div key={p.userId} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-white/5">
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              {p.name}
              {p.isHost && <Crown size={13} className="shrink-0 text-accent" />}
            </span>
            {p.isMuted && <MicOff size={14} className="shrink-0 text-white/40" />}
          </div>
        ))}

        {departed.length > 0 && (
          <>
            <p className="mt-3 px-2 text-xs font-medium uppercase tracking-wide text-white/30">
              Not currently in the room
            </p>
            {departed.map((p) => (
              <div key={p.userId} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-white/40">
                {p.name}
                {p.isHost && <Crown size={13} className="shrink-0" />}
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
