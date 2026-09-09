"use client";

import {
  AudioLines,
  Captions,
  ChevronUp,
  Hand,
  Mic,
  MicOff,
  MoreVertical,
  PhoneOff,
  ScreenShare,
  Smile,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import type { ReactNode } from "react";

interface ControlBarProps {
  micOn: boolean;
  cameraOn: boolean;
  participantsOpen: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleParticipants: () => void;
  onScreenShareClick: () => void;
  /** Whether you're currently sharing your screen — highlights the button. */
  sharingScreen?: boolean;
  onMoreClick?: () => void;
  onLeave: () => void;
  leaving?: boolean;
  onChat?: () => void;
  onTools?: () => void;
}

function ControlButton({
  onClick,
  label,
  active = false,
  danger = false,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-white/30 ${
        danger
          ? "bg-[#ea4335] text-white hover:bg-[#d93025]"
          : active
            ? "bg-[#8ab4f8] text-[#202124] hover:bg-[#a8c7fa]"
            : "bg-[#3c4043] text-white hover:bg-[#4a4d50]"
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
  sharingScreen = false,
  onMoreClick,
  onLeave,
  leaving = false,
  onChat,
  onTools,
}: ControlBarProps) {
  return (
    <>
      {/* Google Meet-style bottom control strip */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-4 sm:pb-5">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-[#202124]/95 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,.45)] backdrop-blur-xl sm:gap-2 sm:p-2">
          <div
            aria-label="Speaking activity"
            title="Speaking activity"
            className="hidden h-12 w-10 items-center justify-center rounded-full text-[#8ab4f8] sm:flex"
          >
            <AudioLines size={19} className="animate-pulse" />
          </div>

          <ControlButton onClick={onToggleMic} label={micOn ? "Turn off microphone" : "Turn on microphone"} active={micOn}>
            {micOn ? <Mic size={21} /> : <MicOff size={21} />}
          </ControlButton>

          <button
            aria-label="Microphone settings"
            title="Microphone settings"
            className="hidden h-12 w-7 items-center justify-center rounded-full text-white/75 hover:bg-white/10 sm:flex"
          >
            <ChevronUp size={16} />
          </button>

          <ControlButton onClick={onToggleCamera} label={cameraOn ? "Turn off camera" : "Turn on camera"} active={cameraOn}>
            {cameraOn ? <Video size={21} /> : <VideoOff size={21} />}
          </ControlButton>

          <ControlButton
            onClick={onScreenShareClick}
            label={sharingScreen ? "Stop sharing your screen" : "Share screen"}
            active={sharingScreen}
          >
            <ScreenShare size={20} />
          </ControlButton>

          <ControlButton onClick={onTools ?? (() => undefined)} label="Reactions">
            <Smile size={21} />
          </ControlButton>

          <ControlButton onClick={() => undefined} label="Captions">
            <Captions size={20} />
          </ControlButton>

          <ControlButton onClick={() => undefined} label="Raise hand">
            <Hand size={20} />
          </ControlButton>

          <ControlButton onClick={onMoreClick ?? (() => undefined)} label="More options">
            <MoreVertical size={21} />
          </ControlButton>

          <button
            onClick={onLeave}
            disabled={leaving}
            aria-label="Leave meeting"
            title="Leave meeting"
            className="ml-1 flex h-12 min-w-16 items-center justify-center rounded-full bg-[#ea4335] px-5 text-white transition hover:bg-[#d93025] disabled:cursor-wait disabled:opacity-60 sm:min-w-20"
          >
            <PhoneOff size={21} />
          </button>
        </div>
      </div>

      {/* Meet-style utility buttons on the lower-right */}
      <div className="absolute bottom-5 right-4 z-30 hidden items-center gap-1 rounded-full bg-[#202124]/90 p-1.5 shadow-xl ring-1 ring-white/5 md:flex">
        <button onClick={onChat ?? (() => undefined)} aria-label="Chat" title="Chat" className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10">
          <span className="text-[18px]">▤</span>
        </button>
        <button onClick={onTools ?? (() => undefined)} aria-label="Meeting tools" title="Meeting tools" className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10">
          <span className="grid grid-cols-3 gap-1">
            {Array.from({ length: 9 }).map((_, i) => <span key={i} className="h-1.5 w-1.5 rounded-sm bg-current" />)}
          </span>
        </button>
        <button onClick={onToggleParticipants} aria-label="People" title="People" className={`flex h-11 w-11 items-center justify-center rounded-full ${participantsOpen ? "bg-white text-black" : "text-white/90 hover:bg-white/10"}`}>
          <Users size={19} />
        </button>
      </div>
    </>
  );
}
