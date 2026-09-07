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
 *     themself is naturally exempt from this check.
 *
 * Host identity itself is untouched by any of this — `Meeting.hostId`
 * never changes here. See /api/rooms/leave for why.
 *
 * Request body:
 *   { "token": string }   — the room code, e.g. "7fk-2xa-plm"
 *
 * Responses:
 *   200  { meeting: {...}, participant: {...} }
 *   400  { error, details }  — validation failed
 *   401  { error }           — missing/invalid auth token
 *   403  { error }           — first-time join attempted while host is absent
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

  const existingParticipant = await prisma.participant.findUnique({
    where: { meetingId_userId: { meetingId: meeting.id, userId: auth.sub } },
  });

  const isHostThemself = auth.sub === meeting.hostId;

  if (!existingParticipant && !isHostThemself) {
    // First-time join by someone new: only allowed while the host is
    // actively present to admit them.
    const hostIsPresent = await prisma.participant.findFirst({
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
  const participant = await prisma.participant.upsert({
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
