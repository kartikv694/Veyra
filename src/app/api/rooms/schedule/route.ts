import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createUniqueRoomToken, buildRoomLink } from "@/lib/room-code";

export const runtime = "nodejs";

const scheduleSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  emails: z.array(z.string().email()).max(50).default([]),
});

/** Creates a future meeting and optionally adds email addresses to its invite list. */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please choose a valid future date and time." }, { status: 400 });
  }

  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "The scheduled time must be in the future." }, { status: 400 });
  }

  const token = await createUniqueRoomToken();
  const rows = await prisma.$queryRaw<Array<{ id: number; token: string; createdAt: Date; hostId: number; scheduledAt: Date }>>`
    INSERT INTO "Meeting" ("token", "hostId", "createdAt", "updatedAt", "scheduledAt")
    VALUES (${token}, ${auth.sub}, NOW(), NOW(), ${scheduledAt})
    RETURNING "id", "token", "createdAt", "hostId", "scheduledAt"
  `;
  const meeting = rows[0];

  if (!meeting) {
    return NextResponse.json({ error: "Couldn't schedule the meeting." }, { status: 500 });
  }

  await prisma.participants.create({
    data: { meetingId: meeting.id, userId: auth.sub, isHost: true },
  });

  const emails = [...new Set(parsed.data.emails.map((email) => email.trim().toLowerCase()))];
  if (emails.length) {
    await prisma.invite.createMany({
      data: emails.map((email) => ({ meetingId: meeting.id, email })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    meeting: {
      id: meeting.id,
      token: meeting.token,
      link: buildRoomLink(meeting.token),
      createdAt: meeting.createdAt,
      hostId: meeting.hostId,
      scheduledAt: meeting.scheduledAt,
      invited: emails,
    },
  }, { status: 201 });
}
