"use client";

/**
 * Real-time layer for the meeting room: connects to the Socket.IO
 * signaling server (see server.ts) and maintains a full-mesh set of WebRTC
 * peer connections — one RTCPeerConnection per other participant currently
 * in the call, each carrying our local audio/video tracks and receiving
 * theirs.
 *
 * Mesh topology (everyone connects directly to everyone) is the simplest
 * approach and is fine at small scale; it doesn't scale gracefully to large
 * meetings since each participant's upload bandwidth grows with the number
 * of others. A media server (LiveKit/Mediasoup, both already named in the
 * SRS's tech stack table as the alternative) is the standard fix if/when
 * that becomes a problem — swapping it in means replacing this hook, not
 * the room page or VideoTile, since both just consume `peers`.
 *
 * Signaling handshake, mirroring server.ts:
 *   1. On connect, the server tells us who's already in the room
 *      ("room:peers") — we create a PeerConnection for each and send them
 *      an offer, since we're the newcomer.
 *   2. Existing participants get told about us ("peer:joined") and wait for
 *      our offer.
 *   3. Whoever receives an offer creates their own PeerConnection, answers,
 *      and both sides then trade ICE candidates until connected.
 *   4. "peer:media-state" carries live mic/camera toggles (not persisted —
 *      see server.ts). "peer:left" tears down that peer's connection.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getToken } from "@/lib/auth-client";

export interface RemotePeer {
  socketId: string;
  userId: number;
  name: string;
  stream: MediaStream | null;
  micOn: boolean;
  cameraOn: boolean;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function useMeetingRoom(roomToken: string, localStream: MediaStream | null) {
  const [peers, setPeers] = useState<Record<string, RemotePeer>>({});
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(localStream);

  // Keep the ref current, and attach the local stream's tracks to any peer
  // connections that were created before the camera/mic finished loading.
  useEffect(() => {
    localStreamRef.current = localStream;
    if (!localStream) return;
    Object.values(pcsRef.current).forEach((pc) => {
      const alreadySending = new Set(pc.getSenders().map((s) => s.track));
      localStream.getTracks().forEach((track) => {
        if (!alreadySending.has(track)) pc.addTrack(track, localStream);
      });
    });
  }, [localStream]);

  const removePeer = useCallback((socketId: string) => {
    pcsRef.current[socketId]?.close();
    delete pcsRef.current[socketId];
    setPeers((prev) => {
      if (!(socketId in prev)) return prev;
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, []);

  const createPeerConnection = useCallback(
    (socketId: string, userId: number, name: string): RTCPeerConnection => {
      const existing = pcsRef.current[socketId];
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE_SERVERS);

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit("webrtc:ice-candidate", { to: socketId, candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        setPeers((prev) => ({
          ...prev,
          [socketId]: {
            ...(prev[socketId] ?? { socketId, userId, name, micOn: true, cameraOn: true }),
            stream: event.streams[0] ?? null,
          },
        }));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          removePeer(socketId);
        }
      };

      pcsRef.current[socketId] = pc;
      setPeers((prev) => ({
        ...prev,
        [socketId]: prev[socketId] ?? { socketId, userId, name, stream: null, micOn: true, cameraOn: true },
      }));
      return pc;
    },
    [removePeer],
  );

  useEffect(() => {
    const token = getToken();
    if (!token || !roomToken) return;

    const socket = io({ path: "/api/socket", auth: { token, roomToken } });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on(
      "room:peers",
      async (existingPeers: { socketId: string; userId: number; name: string }[]) => {
        for (const peer of existingPeers) {
          const pc = createPeerConnection(peer.socketId, peer.userId, peer.name);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("webrtc:offer", { to: peer.socketId, sdp: offer });
        }
      },
    );

    socket.on("peer:joined", ({ socketId, userId, name }: { socketId: string; userId: number; name: string }) => {
      // Just register their presence now; they'll receive our offer once
      // *they* get this room's peer list — no, wait: we are already here,
      // so per the handshake it's the newcomer who initiates. We simply
      // wait for their "webrtc:offer" and answer it below.
      setPeers((prev) => ({
        ...prev,
        [socketId]: prev[socketId] ?? { socketId, userId, name, stream: null, micOn: true, cameraOn: true },
      }));
    });

    socket.on(
      "webrtc:offer",
      async ({
        from,
        fromUserId,
        name,
        sdp,
      }: {
        from: string;
        fromUserId: number;
        name: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        const pc = createPeerConnection(from, fromUserId, name);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc:answer", { to: from, sdp: answer });
      },
    );

    socket.on("webrtc:answer", async ({ from, sdp }: { from: string; sdp: RTCSessionDescriptionInit }) => {
      const pc = pcsRef.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    socket.on(
      "webrtc:ice-candidate",
      async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
        const pc = pcsRef.current[from];
        if (!pc) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Can happen if a candidate arrives before setRemoteDescription
          // has resolved — benign, later candidates still get through.
        }
      },
    );

    socket.on(
      "peer:media-state",
      ({ socketId, micOn, cameraOn }: { socketId: string; micOn: boolean; cameraOn: boolean }) => {
        setPeers((prev) => (prev[socketId] ? { ...prev, [socketId]: { ...prev[socketId], micOn, cameraOn } } : prev));
      },
    );

    socket.on("peer:left", ({ socketId }: { socketId: string }) => {
      removePeer(socketId);
    });

    return () => {
      Object.keys(pcsRef.current).forEach(removePeer);
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomToken]);

  const broadcastMediaState = useCallback((micOn: boolean, cameraOn: boolean) => {
    socketRef.current?.emit("peer:media-state", { micOn, cameraOn });
  }, []);

  return { peers: Object.values(peers), connected, broadcastMediaState };
}
