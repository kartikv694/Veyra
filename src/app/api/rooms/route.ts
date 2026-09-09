/**
 * /api/rooms
 *
 * POST — Create a new meeting. The caller is automatically assigned as
 *         host (per the SRS: "Automatically assign the meeting creator as
 *         Host") and gets a Participant row with isHost: true.
 * GET  — List the caller's meetings (hosted or joined), most recent first.
 *         Backs the dashboard's "Recent meetings" list.
 *
 * Both require `Authorization: Bearer <token>` from /api/auth/login or
 * /api/auth/signup.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, unauthorized } from "@/lib/auth";
import { createUniqueRoomToken, buildRoomLink } from "@/lib/room-code";

export const runtime = "nodejs";

/**
 * POST /api/rooms
 *
 * Request body: none required.
 *
 * Responses:
 *   201  { meeting: { id, token, link, createdAt, hostId } }
 *   401  { error }  — missing/invalid token
 */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth) return unauthorized();

  const token = await createUniqueRoomToken();

  // Create the meeting and the host's own participant row together, so we
  // never end up with a meeting that has no host participant record.
  const meeting = await prisma.$transaction(async (tx) => {
    const created = await tx.meeting.create({
      data: { token, hostId: auth.sub },
    });
    await tx.participants.create({
      data: { meetingId: created.id, userId: auth.sub, isHost: true },
    });
    return created;
  });

  return NextResponse.json(
    {
      meeting: {
        id: meeting.id,
        token: meeting.token,
        link: buildRoomLink(meeting.token),
        createdAt: meeting.createdAt,
        hostId: meeting.hostId,
      },
    },
    { status: 201 },
  );
}

/**
 * GET /api/rooms
 *
 * Responses:
 *   200  { meetings: [{ id, token, link, createdAt, endAt, isHost, participantCount }] }
 *   401  { error }
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth) return unauthorized();

  const meetings = await prisma.meeting.findMany({
    where: {
      OR: [{ hostId: auth.sub }, { participants: { some: { userId: auth.sub } } }],
    },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { participants: true } } },
  });

  return NextResponse.json({
    meetings: meetings.map((m) => ({
      id: m.id,
      token: m.token,
      link: buildRoomLink(m.token),
      createdAt: m.createdAt,
      endAt: m.endAt,
      isHost: m.hostId === auth.sub,
      participantCount: m._count.participants,
    })),
  });
}
