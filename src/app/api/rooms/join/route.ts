/**
 * 
 *
 * Joins the caller to an existing meeting by its room token.
 * Requires `Authorization: Bearer <token>`.
 *
 * Two distinct cases, because host presence gates admission differently
 * depending on whether you've been in this meeting before:
 *
 *   - RETURNING participant (already has a Participant row here, e.g.
 *     reconnecting after a dropped call): always allowed, regardless of
 *     whether the host is currently in the meeting. Just clears `leftAt`.
 *     This is what keeps the room "still running" and freely re-joinable
 *     for people already part of it even while the host is away.
 *
 *   - FIRST-TIME participant (no existing row — this is a fresh invite):
 *     blocked unless the host is currently active in the meeting (an
 *     active Participant row with `isHost: true` and `leftAt: null`).
 *     Joining is invite/token-based, so admitting a brand-new person
 *     without anyone with host rights present isn't allowed. The host
 *     themself is naturally exempt from this check. A locked meeting
 *     (`Meeting.locked`, toggled via PATCH /api/rooms/[token]/lock) blocks
 *     first-time joins the same way, host-presence or not. If the meeting
 *     has a passcode set (`Meeting.passcode`, via PATCH
 *     /api/rooms/[token]/passcode), a matching `passcode` field is also
 *     required on first-time join.
 *
 * Host identity itself is untouched by any of this — `Meeting.hostId`
 * never changes here. See /api/rooms/leave for why.
 *
 * Request body:
 *   { "token": string, "passcode"?: string }   — passcode only needed if
 *     the meeting has one set and you're joining for the first time
 *
 * Responses:
 *   200  { meeting: {...}, participant: {...} }
 *   400  { error, details }  — validation failed
 *   401  { error }           — missing/invalid auth token, or wrong passcode
 *   403  { error }           — first-time join attempted while host is absent, or meeting is locked
 *   404  { error }           — no meeting with that token
 *   410  { error }           — meeting has already ended
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, unauthorized } from "@/lib/auth";
import { buildRoomLink } from "@/lib/room-code";

export const runtime = "nodejs";

const joinSchema = z.object({
  token: z.string().min(1, "Room token is required"),
  /** Required only if the meeting has a passcode set — checked alongside
   *  the locked check below, since both only gate first-time joins. */
  passcode: z.string().optional(),
});

// POST /api/rooms/join
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const meeting = await prisma.meeting.findUnique({ where: { token: parsed.data.token } });
  if (!meeting) {
    return NextResponse.json({ error: "No meeting found with that room code." }, { status: 404 });
  }
  if (meeting.endAt) {
    return NextResponse.json({ error: "This meeting has already ended." }, { status: 410 });
  }

  const existingParticipant = await prisma.participants.findUnique({
    where: { meetingId_userId: { meetingId: meeting.id, userId: auth.sub } },
  });

  const isHostThemself = auth.sub === meeting.hostId;

  if (!existingParticipant && !isHostThemself) {
    if (meeting.locked) {
      return NextResponse.json(
        { error: "This meeting is locked. Ask the host to let you in." },
        { status: 403 },
      );
    }

    if (meeting.passcode !== null && meeting.passcode !== parsed.data.passcode) {
      return NextResponse.json(
        { error: "Incorrect meeting passcode." },
        { status: 401 },
      );
    }

    // First-time join by someone new: only allowed while the host is
    // actively present to admit them.
    const hostIsPresent = await prisma.participants.findFirst({
      where: { meetingId: meeting.id, userId: meeting.hostId, isHost: true, leftAt: null },
    });
    if (!hostIsPresent) {
      return NextResponse.json(
        { error: "The host isn't currently in the meeting. New participants can't join until the host returns." },
        { status: 403 },
      );
    }
  }

  // Returning participants (including the host reconnecting) always get in —
  // this just clears leftAt. isHost is only ever set on first creation
  // (below), never touched on a rejoin, so a returning host regains their
  // rights automatically and a returning regular participant stays regular.
  const participant = await prisma.participants.upsert({
    where: { meetingId_userId: { meetingId: meeting.id, userId: auth.sub } },
    update: { leftAt: null },
    create: {
      meetingId: meeting.id,
      userId: auth.sub,
      isHost: isHostThemself,
    },
  });

  return NextResponse.json({
    meeting: {
      id: meeting.id,
      token: meeting.token,
      link: buildRoomLink(meeting.token),
      createdAt: meeting.createdAt,
      hostId: meeting.hostId,
    },
    participant: {
      id: participant.id,
      isHost: participant.isHost,
      isMuted: participant.isMuted,
      joinedAt: participant.joinedAt,
    },
  });
}
