/**
 * Host-only. Denies a waiting join request. The person's lobby (via
 * polling, and the "join-request:resolved" push as a fallback) shows
 * that they weren't let in and sends them back to the dashboard.
 *
 * Responses:
 *   200  { denied: userId }
 *   401  { error }
 *   403  { error }  — caller isn't the host
 *   404  { error }  — no such meeting or request
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emitToUser } from "@/lib/socket-emitters";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; requestId: string }> },
) {
  const auth = requireAuth(req);
  if (!auth) return unauthorized();

  const { token, requestId } = await params;
  const meeting = await prisma.meeting.findUnique({ where: { token } });
  if (!meeting) {
    return NextResponse.json({ error: "No meeting found with that room code." }, { status: 404 });
  }
  if (meeting.hostId !== auth.sub) {
    return NextResponse.json({ error: "Only the host can deny people." }, { status: 403 });
  }

  const request = await prisma.joinRequest.findFirst({
    where: { id: Number(requestId), meetingId: meeting.id, status: "PENDING" },
  });
  if (!request) {
    return NextResponse.json({ error: "That request isn't pending anymore." }, { status: 404 });
  }

  await prisma.joinRequest.update({
    where: { id: request.id },
    data: { status: "DENIED", resolvedAt: new Date() },
  });

  emitToUser(meeting.token, request.userId, "join-request:resolved", { admitted: false });

  return NextResponse.json({ denied: request.userId });
}
