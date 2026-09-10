/**
 * Joins the caller to an existing meeting by its room token.
 * Requires `Authorization: Bearer <token>`.
 *
 * Three distinct cases:
 *
 *   - RETURNING participant (already has a Participant row here, e.g.
 *     reconnecting after a dropped call, or the host themself): always
 *     let straight in, regardless of anything else below. Just clears
 *     `leftAt`. This is what keeps the room freely re-joinable for
 *     people already part of it.
 *
 *   - FIRST-TIME participant whose account email matches an `Invite`
 *     the host sent for this meeting (see POST /api/rooms/[token]/invite),
 *     OR who supplies the correct meeting passcode: let straight in,
 *     same as a returning participant. Being invited or knowing the
 *     passcode is treated as the host's explicit permission already
 *     given, so there's nothing to wait on.
 *
 *   - Everyone else, first time: NOT let in directly. Instead this
 *     creates (or refreshes) a `JoinRequest` and notifies the host in
 *     real time — the waiting-room mechanism (SRS: host admits
 *     participants before they can join). The caller gets a 202 with
 *     `{ pending: true, requestId }` instead of a meeting/participant
 *     payload; the frontend polls GET .../join-requests/mine until the
 *     host admits or denies it.
 *
 * A locked meeting (`Meeting.locked`) blocks ALL first-time joins
 * outright — even an invited email or correct passcode — since locking
 * is meant as an absolute "no new joins right now", not just "no
 * uninvited joins". It never affects returning participants.
 *
 * Host identity itself is untouched by any of this — `Meeting.hostId`
 * never changes here. See /api/rooms/leave for why.
 *
 * Request body:
 *   { "token": string, "passcode"?: string }
 *
 * Responses:
 *   200  { meeting: {...}, participant: {...} }              — let straight in
 *   202  { pending: true, requestId: number }                 — waiting on host
 *   400  { error, details }  — validation failed
 *   401  { error }           — missing/invalid auth token
 *   403  { error }           — meeting is locked
 *   404  { error }           — no meeting with that token
 *   410  { error }           — meeting has already ended
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, unauthorized } from "@/lib/auth";
import { buildRoomLink } from "@/lib/room-code";
import { emitToUser } from "@/lib/socket-emitters";

export const runtime = "nodejs";

const joinSchema = z.object({
  token: z.string().min(1, "Room token is required"),
  /** Alternate direct-entry path alongside being explicitly invited. */
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
  const isReturning = Boolean(existingParticipant) || isHostThemself;

  if (!isReturning) {
    if (meeting.locked) {
      return NextResponse.json(
        { error: "This meeting is locked. Ask the host to let you in." },
        { status: 403 },
      );
    }

    const me = await prisma.users.findUnique({ where: { id: auth.sub }, select: { email: true, name: true } });
    const invited = me
      ? await prisma.invite.findFirst({
          where: { meetingId: meeting.id, email: { equals: me.email, mode: "insensitive" } },
        })
      : null;
    const passcodeMatches =
      meeting.passcode !== null && meeting.passcode === parsed.data.passcode;

    if (!invited && !passcodeMatches) {
      // Not pre-approved — queue a waiting-room request instead of
      // letting them in, and let the host know right away.
      const request = await prisma.joinRequest.upsert({
        where: { meetingId_userId: { meetingId: meeting.id, userId: auth.sub } },
        update: { status: "PENDING", requestedAt: new Date(), resolvedAt: null },
        create: { meetingId: meeting.id, userId: auth.sub, status: "PENDING" },
      });

      emitToUser(meeting.token, meeting.hostId, "join-request:new", {
        requestId: request.id,
        userId: auth.sub,
        name: me?.name ?? me?.email ?? "Someone",
      });

      return NextResponse.json({ pending: true, requestId: request.id }, { status: 202 });
    }
  }

  // Returning participants (including the host reconnecting), invited
  // emails, and correct passcodes all land here — this just clears
  // leftAt. isHost is only ever set on first creation (below), never
  // touched on a rejoin, so a returning host regains their rights
  // automatically and a returning regular participant stays regular.
  const participant = await prisma.participants.upsert({
    where: { meetingId_userId: { meetingId: meeting.id, userId: auth.sub } },
    update: { leftAt: null },
    create: {
      meetingId: meeting.id,
      userId: auth.sub,
      isHost: isHostThemself,
    },
  });

  // Clear any resolved/pending request now that they're actually in —
  // keeps GET .../join-requests from showing a stale entry for someone
  // who's since been let in some other way (e.g. the host invited them
  // by email after they'd already asked to join).
  await prisma.joinRequest.updateMany({
    where: { meetingId: meeting.id, userId: auth.sub, status: "PENDING" },
    data: { status: "ADMITTED", resolvedAt: new Date() },
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
