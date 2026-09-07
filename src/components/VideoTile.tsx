"use client";

/**
 * One participant's tile in the meeting grid.
 *
 * `stream` can now be either the local camera (getUserMedia) or a real
 * remote peer's MediaStream (from useMeetingRoom's WebRTC connection) —
 * this component doesn't know or care which. A tile with `cameraOn: true`
 * but no stream yet just means that peer's connection hasn't finished
 * negotiating; it falls back to the avatar automatically.
 *
 * `speaking` is still a visual-only prop — nothing sets it yet, since that
 * needs real audio-level analysis on the live streams this component now
 * receives. It's wired through so the SRS's "current active speaker"
 * requirement has somewhere to land once that analysis exists.
 */
import { MicOff } from "lucide-react";

interface VideoTileProps {
  name: string;
  isHost?: boolean;
  isMuted?: boolean;
  cameraOn?: boolean;
  /** Local camera stream to render, if this tile has live video. */
  stream?: MediaStream | null;
  /** Visual-only placeholder for "this person is currently speaking". */
  speaking?: boolean;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function VideoTile({
  name,
  isHost = false,
  isMuted = false,
  cameraOn = false,
  stream = null,
  speaking = false,
}: VideoTileProps) {
  return (
    <div
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-[#171A21] ring-2 transition-all ${
        speaking ? "ring-accent" : "ring-transparent"
      }`}
    >
      {cameraOn && stream ? (
        <video
          autoPlay
          muted
          playsInline
          ref={(el) => {
            if (el && el.srcObject !== stream) el.srcObject = stream;
          }}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-lg font-semibold text-white">
          {initials(name)}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
        <span className="truncate text-sm font-medium text-white">
          {name}
          {isHost && <span className="ml-1.5 text-xs font-normal text-white/60">Host</span>}
        </span>
        {isMuted && <MicOff size={14} className="shrink-0 text-white/80" />}
      </div>
    </div>
  );
}
