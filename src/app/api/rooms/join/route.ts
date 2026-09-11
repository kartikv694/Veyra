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
 *     the host sent for this meeting (see POST /api/rooms/[token]/invite):
 *     let straight in.
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
 * outright — even an invited email — since locking is meant as an absolute
 * "no new joins right now". It never affects returning participants.
 *
 * Host identity itself is untouched by any of this — `Meeting.hostId`
 * never changes here. See /api/rooms/leave for why.
 *
 * Request body:
 *   { "token": string }
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

  const scheduledRows = await prisma.$queryRaw<Array<{ scheduledAt: Date | null }>>`
    SELECT "scheduledAt" FROM "Meeting" WHERE "id" = ${meeting.id}
  `;
  const scheduledAt = scheduledRows[0]?.scheduledAt ?? null;
  if (scheduledAt && scheduledAt.getTime() > Date.now()) {
    return NextResponse.json(
      { error: `This meeting is scheduled for ${scheduledAt.toLocaleString()}.` },
      { status: 403 },
    );
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
    if (!invited) {
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

  // Returning participants (including the host reconnecting) and invited
  // emails land here — this just clears
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

  // Return the active roster with the join response. This removes the
  // follow-up GET /api/rooms call that the room page previously made after
  // every successful join.
  const activeParticipants = await prisma.participants.findMany({
    where: { meetingId: meeting.id, leftAt: null },
    select: {
      userId: true,
      isHost: true,
      isMuted: true,
      isCameraOff: true,
      joinedAt: true,
      leftAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { joinedAt: "asc" },
  });

  return NextResponse.json({
    meeting: {
      id: meeting.id,
      token: meeting.token,
      link: buildRoomLink(meeting.token),
      createdAt: meeting.createdAt,
      scheduledAt,
      endAt: meeting.endAt,
      hostId: meeting.hostId,
      locked: meeting.locked,
      passcodeSet: meeting.passcode !== null,
    },
    participant: {
      id: participant.id,
      isHost: participant.isHost,
      isMuted: participant.isMuted,
      joinedAt: participant.joinedAt,
    },
    participants: activeParticipants.map((p) => ({
      userId: p.userId,
      name: p.user.name,
      email: p.user.email,
      isHost: p.isHost,
      isMuted: p.isMuted,
      isCameraOff: p.isCameraOff,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
    })),
  });
}
