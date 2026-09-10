/**
 * Host-only. Adds one or more email addresses to a meeting's invite
 * list — anyone whose account email matches one of these gets let
 * straight into the meeting (see POST /api/rooms/join) instead of
 * having to wait in the lobby for the host to admit them.
 *
 * The invited person doesn't need an account yet at invite time — the
 * match happens by email when they actually try to join. Inviting the
 * same email twice for the same meeting is a no-op (unique constraint),
 * not an error.
 *
 * Request body:
 *   { "emails": string[] }
 *
 * Responses:
 *   200  { invited: string[] }
 *   400  { error, details }
 *   401  { error }
 *   403  { error }  — caller isn't the host
 *   404  { error }  — no such meeting
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const inviteSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(50),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const auth = requireAuth(req);
  if (!auth) return unauthorized();

  const { token } = await params;
  const body = await req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const meeting = await prisma.meeting.findUnique({ where: { token } });
  if (!meeting) {
    return NextResponse.json({ error: "No meeting found with that room code." }, { status: 404 });
  }
  if (meeting.hostId !== auth.sub) {
    return NextResponse.json({ error: "Only the host can invite people." }, { status: 403 });
  }

  const emails = [...new Set(parsed.data.emails.map((e) => e.trim().toLowerCase()))];
  await Promise.all(
    emails.map((email) =>
      prisma.invite.upsert({
        where: { meetingId_email: { meetingId: meeting.id, email } },
        update: {},
        create: { meetingId: meeting.id, email },
      }),
    ),
  );

  return NextResponse.json({ invited: emails });
}
