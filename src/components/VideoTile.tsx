"use client";

/**
 * One participant's tile in the meeting grid.
 *
 * The tile also measures the audio level of its MediaStream locally. This
 * gives every participant a live speaking indicator without sending audio
 * levels through Socket.IO.
 */
import { useEffect, useState } from "react";
import { AudioWaveform, Hand, MicOff } from "lucide-react";

interface VideoTileProps {
  name: string;
  isHost?: boolean;
  isMuted?: boolean;
  cameraOn?: boolean;
  /** Local camera stream or a remote peer's MediaStream. */
  stream?: MediaStream | null;
  /** True when this tile belongs to the current user. */
  isLocal?: boolean;
  /** Shows a raised-hand badge in the corner. */
  handRaised?: boolean;
  /** Set false for full-bleed views (solo camera, presenting) to match
   *  Meet's edge-to-edge look. Defaults true for grid/thumbnail tiles. */
  rounded?: boolean;
  /** Mirrors the video horizontally — set true for your own camera (a
   *  natural mirror-image self-view, matching every video call app), but
   *  NEVER for a screen share (mirroring shared content backwards would
   *  make it unreadable) or a remote participant's camera (only correct
   *  from their own vantage point, not ours). */
  mirrored?: boolean;
}

function initials(name: string): string {
  // The name passed in sometimes has a display suffix baked in (e.g.
  // "Tester (You)") — strip anything in parentheses before computing
  // initials, or a suffix word gets treated as its own "name" and
  // contributes a stray character (was producing "T(" for "Tester (You)").
  const base = name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  return base
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function SpeakingIndicator({ speaking }: { speaking: boolean }) {
  if (!speaking) return null;

  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent shadow-[0_0_14px_rgba(255,255,255,0.08)]"
      title="Speaking"
      aria-label="Speaking"
    >
      <AudioWaveform size={16} className="animate-pulse" />
    </span>
  );
}

export function VideoTile({
  name,
  isHost = false,
  isMuted = false,
  cameraOn = false,
  stream = null,
  isLocal = false,
  handRaised = false,
  rounded = true,
  mirrored = false,
}: VideoTileProps) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || isMuted || stream.getAudioTracks().length === 0) {
      setSpeaking(false);
      return;
    }

    const AudioContextClass = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;

    const detect = () => {
      analyser.getByteTimeDomainData(samples);

      let sum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / samples.length);
      setSpeaking(rms > 0.045);
      frame = window.setTimeout(detect, 90);
    };

    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => undefined);
    }
    detect();

    return () => {
      window.clearTimeout(frame);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close().catch(() => undefined);
      setSpeaking(false);
    };
  }, [stream, isMuted]);

  return (
    <div
      className={`relative flex h-full min-h-0 items-center justify-center overflow-hidden ring-2 transition-all duration-200 ${
        rounded ? "rounded-xl" : "rounded-none"
      } ${cameraOn && stream ? "bg-[#171A21]" : "bg-[#2A2350]"} ${
        speaking ? "ring-accent shadow-[0_0_24px_rgba(255,255,255,0.08)]" : "ring-transparent"
      }`}
    >
      {cameraOn && stream ? (
        <video
          autoPlay
          muted={isLocal}
          playsInline
          ref={(el) => {
            if (el && el.srcObject !== stream) {
              el.srcObject = stream;
              if (!isLocal) void el.play().catch(() => undefined);
            }
          }}
          className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""}`}
        />
      ) : (
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-lg font-semibold text-white transition-transform duration-200 ${
            speaking ? "scale-105" : "scale-100"
          }`}
        >
          {initials(name)}
        </div>
      )}

      {handRaised && (
        <div
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-[#202124] shadow-lg"
          title={`${name} raised their hand`}
        >
          <Hand size={16} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium text-white">
          {name}
          {isHost && <span className="ml-1.5 text-xs font-normal text-white/60">Host</span>}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <SpeakingIndicator speaking={speaking} />
          {isMuted && <MicOff size={14} className="shrink-0 text-white/80" />}
        </div>
      </div>
    </div>
  );
}
