"use client";

/**
 * Bottom control bar for the meeting room: mic, camera, screen share,
 * participants panel toggle, and leave — plus, host-only, lock/unlock
 * meeting access and end-meeting-for-everyone.
 *
 * Screen share is a stub — clicking it just informs the caller (via
 * `onScreenShareClick`) rather than doing anything, since real screen
 * sharing needs its own signaling path beyond what's built so far.
 */
import { Mic, MicOff, Video, VideoOff, ScreenShare, Users, PhoneOff, Lock, LockOpen } from "lucide-react";
import type { ReactNode } from "react";

interface ControlBarProps {
  micOn: boolean;
  cameraOn: boolean;
  participantsOpen: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleParticipants: () => void;
  onScreenShareClick: () => void;
  onLeave: () => void;
  leaving?: boolean;
  /** Renders the lock toggle and "End meeting" button when true. */
  isHost?: boolean;
  locked?: boolean;
  onToggleLock?: () => void;
  onEndMeeting?: () => void;
  ending?: boolean;
}

function ControlButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
        active
          ? "bg-white/10 text-white hover:bg-white/15"
          : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
      }`}
    >
      {children}
    </button>
  );
}

export function ControlBar({
  micOn,
  cameraOn,
  participantsOpen,
  onToggleMic,
  onToggleCamera,
  onToggleParticipants,
  onScreenShareClick,
  onLeave,
  leaving = false,
  isHost = false,
  locked = false,
  onToggleLock,
  onEndMeeting,
  ending = false,
}: ControlBarProps) {
  return (
    <div className="flex items-center justify-center gap-3 border-t border-white/10 bg-[#0F1115] px-6 py-4">
      <ControlButton active={micOn} onClick={onToggleMic} label={micOn ? "Mute microphone" : "Unmute microphone"}>
        {micOn ? <Mic size={18} /> : <MicOff size={18} />}
      </ControlButton>

      <ControlButton active={cameraOn} onClick={onToggleCamera} label={cameraOn ? "Turn off camera" : "Turn on camera"}>
        {cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
      </ControlButton>

      <ControlButton onClick={onScreenShareClick} label="Share screen">
        <ScreenShare size={18} />
      </ControlButton>

      <ControlButton active={participantsOpen} onClick={onToggleParticipants} label="Participants">
        <Users size={18} />
      </ControlButton>

      {isHost && onToggleLock && (
        <ControlButton
          active={locked}
          onClick={onToggleLock}
          label={locked ? "Unlock meeting (allow new participants)" : "Lock meeting (block new participants)"}
        >
          {locked ? <Lock size={18} /> : <LockOpen size={18} />}
        </ControlButton>
      )}

      <button
        onClick={onLeave}
        disabled={leaving}
        aria-label="Leave meeting"
        title="Leave meeting"
        className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-60"
      >
        <PhoneOff size={16} />
        {leaving ? "Leaving..." : "Leave"}
      </button>

      {isHost && onEndMeeting && (
        <button
          onClick={onEndMeeting}
          disabled={ending}
          aria-label="End meeting for everyone"
          title="End meeting for everyone"
          className="flex h-11 items-center gap-2 rounded-full bg-red-500/90 px-5 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
        >
          <PhoneOff size={16} />
          {ending ? "Ending..." : "End for everyone"}
        </button>
      )}
    </div>
  );
}
