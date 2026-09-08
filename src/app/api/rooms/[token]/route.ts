/**
 *
 * Returns a meeting's details plus its full participant roster — what the
 * meeting-room screen needs to render video tiles and the participant list
 * (SRS: "Display participant video tiles and participant list").
 *
 * Access is restricted to people who are (or have been) an active
 * participant in this specific meeting — not just any authenticated user —
 * so someone can't enumerate room tokens to see who's in other people's
 * meetings.
 *
 * Responses:
 *   200  {
 *     meeting: { id, token, createdAt, endAt, hostId, locked },
 *     participants: [{ userId, name, email, isHost, isMuted, joinedAt, leftAt }]
 *   }
 *   401  { error }  — missing/invalid auth token
 *   403  { error }  — caller has never joined this meeting
 *   404  { error }  — no meeting with this token
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

// GET /api/rooms/[token]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = requireAuth(req);

  if (!auth) return unauthorized();

  const { token } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { token },
    include: {
      participants: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          joinedAt: "asc",
        },
      },
    },
  });

  if (!meeting) {
    return NextResponse.json(
      { error: "No meeting found with that room code." },
      { status: 404 },
    );
  }

  // Get the exact participant type returned by Prisma
  type MeetingParticipant = (typeof meeting.participants)[number];

  const callerIsParticipant = meeting.participants.some(
    (p: MeetingParticipant) => p.userId === auth.sub,
  );

  if (!callerIsParticipant) {
    return NextResponse.json(
      { error: "You don't have access to this meeting." },
      { status: 403 },
    );
  }

  return NextResponse.json({
    meeting: {
      id: meeting.id,
      token: meeting.token,
      createdAt: meeting.createdAt,
      endAt: meeting.endAt,
      hostId: meeting.hostId,
      locked: meeting.locked,
    },

    participants: meeting.participants.map(
      (p: MeetingParticipant) => ({
        userId: p.userId,
        name: p.user.name,
        email: p.user.email,
        isHost: p.isHost,
        isMuted: p.isMuted,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      }),
    ),
  });
}