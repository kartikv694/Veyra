/**
 * Custom Next.js server.
 *
 * Why this file exists: Socket.IO needs a long-lived HTTP server it can
 * upgrade connections on, which Next's own serverless-style API route
 * handlers don't provide. So instead of `next dev` / `next start`, both
 * `npm run dev` and `npm run start` now run this file (see package.json) —
 * it creates one raw Node HTTP server, attaches Socket.IO to it for
 * real-time signaling, and hands every other request to Next as normal.
 * Nothing about routing, pages, or API routes changes; this only adds the
 * WebSocket layer alongside them.
 *
 * Request routing note: both Socket.IO and Next register a 'request'
 * listener on the same underlying HTTP server. Our own listener explicitly
 * skips anything under SOCKET_PATH so Socket.IO's own listener is the one
 * that answers those — otherwise both would try to write a response to the
 * same request.
 */
import { createServer } from "node:http";
import next from "next";
import { Server, type Socket } from "socket.io";
import { verifyAuthToken } from "./src/lib/auth";
import { prisma } from "./src/lib/prisma";
import { setIO, userChannel } from "@/lib/socket-emitters";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const SOCKET_PATH = "/api/socket";

const app = next({ dev });
const handleNextRequest = app.getRequestHandler();

/** Data Socket.IO's auth middleware attaches to each verified connection. */
interface SocketData {
  userId: number;
  roomToken: string;
  name: string;
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    if (req.url?.startsWith(SOCKET_PATH)) return; // Socket.IO's own listener handles this.
    handleNextRequest(req, res);
  });

  const io = new Server<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, never>,
    SocketData
  >(httpServer, { path: SOCKET_PATH });

  // Let REST route handlers (running in this same process) push real-time
  // events after a mutation — e.g. a host's mute/remove call reaching the
  // affected participant's browser immediately. See src/lib/socket-emitter.ts.
  setIO(io);

  /**
   * Auth middleware: every connection must present a valid JWT (the same
   * one issued at login/signup) plus the room token it wants to join, and
   * must already be an active participant of that meeting per the
   * database — matches the access rules already enforced by the REST API,
   * so the socket layer can't be used to bypass them.
   */
  io.use(async (socket, next) => {
    const { token, roomToken } = socket.handshake.auth as { token?: string; roomToken?: string };
    if (!token || !roomToken) {
      return next(new Error("Missing token or roomToken"));
    }

    const payload = verifyAuthToken(token);
    if (!payload) {
      return next(new Error("Invalid or expired token"));
    }

    const participant = await prisma.participant.findFirst({
      where: { userId: payload.sub, leftAt: null, meeting: { token: roomToken } },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!participant) {
      return next(new Error("Not an active participant in this meeting"));
    }

    socket.data.userId = payload.sub;
    socket.data.roomToken = roomToken;
    socket.data.name = participant.user.name ?? participant.user.email;
    next();
  });

  io.on("connection", (socket: Socket<any, any, any, SocketData>) => {
    const { roomToken, userId, name } = socket.data;
    socket.join(roomToken);
    // Lets a REST handler (e.g. host mutes/removes this user) target this
    // specific person without knowing their live socket id.
    socket.join(userChannel(roomToken, userId));

    // Tell the newcomer who's already in the room, so *they* initiate the
    // WebRTC offer to each existing peer (see src/hooks/useMeetingRoom.ts).
    const roomSocketIds = io.sockets.adapter.rooms.get(roomToken);
    const existingPeers = roomSocketIds
      ? [...roomSocketIds]
          .filter((id) => id !== socket.id)
          .map((id) => {
            const peerSocket = io.sockets.sockets.get(id) as Socket<any, any, any, SocketData> | undefined;
            return peerSocket ? { socketId: id, userId: peerSocket.data.userId, name: peerSocket.data.name } : null;
          })
          .filter((p): p is { socketId: string; userId: number; name: string } => p !== null)
      : [];
    socket.emit("room:peers", existingPeers);

    // Tell everyone already there that someone new has arrived (they'll
    // receive an offer from the newcomer shortly).
    socket.to(roomToken).emit("peer:joined", { socketId: socket.id, userId, name });

    // --- WebRTC signaling relay: server never inspects SDP/ICE contents,
    // it just forwards between the two socket ids involved. ---
    socket.on("webrtc:offer", ({ to, sdp }: { to: string; sdp: unknown }) => {
      // @ts-ignore
      io.to(to).emit("webrtc:offer", { from: socket.id, fromUserId: userId, name, sdp });
    });

    socket.on("webrtc:answer", ({ to, sdp }: { to: string; sdp: unknown }) => {
      // @ts-ignore
      io.to(to).emit("webrtc:answer", { from: socket.id, sdp });
    });

    socket.on("webrtc:ice-candidate", ({ to, candidate }: { to: string; candidate: unknown }) => {
      // @ts-ignore
      io.to(to).emit("webrtc:ice-candidate", { from: socket.id, candidate });
    });

    // Live mic/camera state — deliberately NOT written to the database.
    // It's ephemeral connection state, not the durable Participant.isMuted
    // field; broadcasting it over the socket is what makes mute icons
    // update in real time without a network round trip per toggle.
    socket.on("peer:media-state", (state: { micOn: boolean; cameraOn: boolean }) => {
      socket.to(roomToken).emit("peer:media-state", { socketId: socket.id, userId, ...state });
    });

    socket.on("disconnect", () => {
      socket.to(roomToken).emit("peer:left", { socketId: socket.id, userId });
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Veyra ready on http://localhost:${port} (Socket.IO at ${SOCKET_PATH})`);
  });
});
