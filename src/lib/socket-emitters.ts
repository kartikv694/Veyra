/**
 * Access to the single Socket.IO server instance created in server.ts, so
 * REST route handlers — running in that same Node process (see server.ts's
 * doc comment for why a custom server exists) — can push a real-time event
 * right after a database mutation. This is how a host's REST call to mute
 * or remove someone reaches that person's browser immediately, instead of
 * waiting for their next roster poll.
 *
 * This only works because everything runs in one process. If this app were
 * ever split across multiple server instances, this global would need to
 * become a real pub/sub bus (e.g. Redis) instead — out of scope for the
 * current single-instance setup, but worth knowing if that changes.
 */

import { Server } from "socket.io";


declare global{
    var __veyraIO: Server | undefined;
}

/** Called once from server.ts, right after the Socket.IO server is created. */
export function setIO(io: Server): void {
  globalThis.__veyraIO = io;
}

/** Returns the shared Socket.IO server, or null if it hasn't been set yet
 *  (e.g. this code somehow ran outside server.ts's process). */
export function getIO(): Server | null {
  return globalThis.__veyraIO ?? null;
}

/** The room every socket in a given meeting joins — just the room token
 *  itself. Kept as a named helper so the two sides (server.ts and route
 *  handlers) can't drift on the naming scheme. */
export function meetingChannel(roomToken: string): string {
  return roomToken;
}

/** The room a specific user's socket(s) join within a specific meeting —
 *  lets a route handler target one person without knowing their live
 *  socket id(s) directly. */
export function userChannel(roomToken: string, userId: number): string {
  return `user:${roomToken}:${userId}`;
}
