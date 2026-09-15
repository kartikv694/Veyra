/**
 * Returns this meeting's chat history so far — read once when the room
 * page loads (including on a refresh), so an ongoing conversation isn't
 * lost. Any live message written after that point arrives the normal way,
 * over the socket (peer:chat-message) — see server.ts, which is also what
 * actually writes each message to the database this endpoint reads from.
 *
 * Anyone currently a participant can read this, not just the host — chat
 * is visible to everyone in the meeting, same as it always was live.
 *
 * Responses:
 *   200  { messages: { id, userId, fromName, text, at }[] }
 *   401  { error }
 *   403  { error }  — caller has never been a participant of this meeting
 *   404  { error }  — no such meeting
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const auth = requireAuth(req);
  if (!auth) return unauthorized();

  const { token } = await params;
  const meeting = await prisma.meeting.findUnique({ where: { token } });
  if (!meeting) {
    return NextResponse.json({ error: "No meeting found with that room code." }, { status: 404 });
  }

  const isParticipant = await prisma.participants.findFirst({
    where: { meetingId: meeting.id, userId: auth.sub },
  });
  if (!isParticipant) {
    return NextResponse.json({ error: "You're not currently in this meeting." }, { status: 403 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { meetingId: meeting.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, fromName: true, text: true, createdAt: true },
  });

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      userId: m.userId,
      fromName: m.fromName,
      text: m.text,
      at: m.createdAt.getTime(),
    })),
  });
}
