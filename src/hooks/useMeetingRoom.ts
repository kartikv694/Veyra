"use client";

/**
 * Real-time layer for the meeting room: connects to the Socket.IO
 * signaling server (see ../../../socket-server/server.ts) and maintains a full-mesh set of WebRTC
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
 * Signaling handshake, mirroring socket-server/server.ts:
 *   1. On connect, the server tells us who's already in the room
 *      ("room:peers") — we create a PeerConnection for each and send them
 *      an offer, since we're the newcomer.
 *   2. Existing participants get told about us ("peer:joined") and wait for
 *      our offer.
 *   3. Whoever receives an offer creates their own PeerConnection, answers,
 *      and both sides then trade ICE candidates until connected.
 *   4. "peer:media-state" carries live mic/camera toggles (not persisted —
 *      see socket-server/server.ts). "peer:left" tears down that peer's connection.
 *
 * Also listens for host-initiated actions pushed from REST route handlers
 * (see src/lib/socket-emitters.ts, which forwards to socket-server): "participant:force-muted" updates the
 * affected peer's `micOn` for everyone (and, if it's *you*, fires
 * `onForceMuted` so the room page can actually disable your mic track),
 * "meeting:removed" fires `onRemoved`, and "meeting:ended" fires
 * `onMeetingEnded`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getToken } from "@/lib/auth-client";

export interface RemotePeer {
  socketId: string;
  userId: number;
  name: string;
  stream: MediaStream | null;
  /** A separate stream for their screen share, distinct from their
   *  camera — kept apart so the UI can render two tiles like Meet does,
   *  instead of the screen share replacing their camera feed. */
  screenStream: MediaStream | null;
  /** The MediaStreamTrack.id of whichever track we've identified as
   *  their camera. Tracked separately from the MediaStream wrapper's own
   *  .id, which is NOT reliably stable across renegotiation — Chrome can
   *  (and did, causing the black-tile bug) re-wrap the same underlying
   *  camera track in a brand-new MediaStream object when a connection
   *  renegotiates for an unrelated reason (e.g. someone starting a
   *  screen share, which renegotiates every peer connection to add that
   *  new track). Comparing stream .id treated that re-wrap as if it were
   *  a second, different stream — mis-filing the camera's own refire as
   *  a "screen share", which corrupted both slots. Track identity is
   *  what's actually stable here. */
  cameraTrackId: string | null;
  micOn: boolean;
  cameraOn: boolean;
  handRaised: boolean;
}

export interface MeetingRoomCallbacks {
  /** The host force-muted *you* specifically (not just any peer). */
  onForceMuted?: () => void;
  /** The host allowed your microphone to be turned back on. */
  onForceUnmuted?: () => void;
  /** The host force-turned-off *your* camera specifically. */
  onForceCameraOff?: () => void;
  /** The host allowed your camera to be turned back on. */
  onForceCameraOn?: () => void;
  /** The host removed *you* from the meeting. */
  onRemoved?: () => void;
  /** The host ended the meeting for everyone. */
  onMeetingEnded?: () => void;
  /** Someone (including yourself, echoed back) sent a quick reaction. */
  onReaction?: (emoji: string, fromName: string) => void;
  /** A chat message arrived (including your own, echoed back — see server.ts). */
  onChatMessage?: (message: { text: string; fromName: string; fromUserId: number; at: number }) => void;
  /** Someone is asking to join — only ever fires for the host, since
   *  that's the only person the server pushes this to. */
  onJoinRequest?: (request: { requestId: number; userId: number; name: string }) => void;
  onPeerJoined?: (peer: { socketId: string; userId: number; name: string }) => void;
  onPeerLeft?: (peer: { socketId: string; userId: number }) => void;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/** Keep the full-mesh topology usable on normal laptops. Each participant
 * uploads one camera stream to every other participant, so an uncapped
 * 720p sender can consume a surprising amount of CPU and upstream bandwidth.
 * These are browser-side hints; WebRTC may choose a lower bitrate when the
 * network is constrained.
 */
function tuneSender(sender: RTCRtpSender, kind: "audio" | "video", screen = false): void {
  try {
    const parameters = sender.getParameters();
    const encoding = parameters.encodings?.[0] ?? {};
    if (kind === "video") {
      encoding.maxBitrate = screen ? 1_500_000 : 850_000;
      encoding.maxFramerate = screen ? 15 : 24;
      parameters.encodings = [encoding];
      parameters.degradationPreference = "balanced";
    } else {
      encoding.maxBitrate = 64_000;
      parameters.encodings = [encoding];
    }
    void sender.setParameters(parameters).catch(() => undefined);
  } catch {
    // Older browsers may not expose sender parameter tuning. The call still
    // works; the browser simply uses its normal WebRTC bitrate controller.
  }
}

export function useMeetingRoom(
  roomToken: string,
  localStream: MediaStream | null,
  myUserId: number | null,
  callbacks: MeetingRoomCallbacks = {},
  enabled: boolean = true,
) {
  const [peers, setPeers] = useState<Record<string, RemotePeer>>({});
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  // Tracks whether we're mid-createOffer for a given peer — needed to
  // detect and resolve "glare" (both sides trying to renegotiate at the
  // same time), see the offer handler below.
  const makingOfferRef = useRef<Record<string, boolean>>({});
  // Set synchronously the instant we start handling someone's incoming
  // offer, before any `await` — this closes a race that checking
  // pc.signalingState alone doesn't fully cover: onnegotiationneeded is
  // queued from the addTrack calls made moments earlier and can fire
  // while we're still mid-way through processing their offer (state not
  // yet transitioned), tries to send its own offer, and corrupts the
  // negotiation on our (answering) side specifically — which is what was
  // actually breaking video/screen-share for the receiving participant.
  const processingOfferRef = useRef<Record<string, boolean>>({});
  const localStreamRef = useRef<MediaStream | null>(localStream);
  // Ref so the socket effect (which intentionally only re-runs on
  // roomToken changing) always calls the latest callbacks, not stale ones
  // captured when the socket was first created.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  // Same reasoning: myUserId is often still null on first render (auth
  // check hasn't resolved yet) by the time this effect first fires, and
  // without a ref that null would be captured forever.
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;

  // Keep the ref current, and attach the local stream's tracks to any peer
  // connections that were created before the camera/mic finished loading.
  useEffect(() => {
    localStreamRef.current = localStream;
    if (!localStream) return;
    Object.values(pcsRef.current).forEach((pc) => {
      const alreadySending = new Set(pc.getSenders().map((s) => s.track));
      localStream.getTracks().forEach((track) => {
        if (!alreadySending.has(track)) {
          const sender = pc.addTrack(track, localStream);
          tuneSender(sender, track.kind === "video" ? "video" : "audio");
        }
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
        const sender = pc.addTrack(track, localStreamRef.current!);
        tuneSender(sender, track.kind === "video" ? "video" : "audio");
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit("webrtc:ice-candidate", { to: socketId, candidate: event.candidate });
        }
      };

      /**
       * This is the piece that was missing entirely before: without it,
       * RTCRtpSender.replaceTrack() works fine (no renegotiation needed),
       * but pc.addTrack() — used whenever a connection didn't already have
       * a video sender (camera was off when the connection formed, then
       * turned on later; or screen share falling back to addTrack) —
       * silently never reaches the other side. The track gets added
       * locally, getSenders() shows it, but the remote peer's SDP was
       * never updated, so their ontrack never fires for it. That's what
       * was causing "screen share only visible to me" and the host's
       * video not showing up for other participants in some sequences.
       */
      pc.onnegotiationneeded = async () => {
        // Critical guard: if we're not in a stable state, a negotiation
        // is already in progress via a different path — most commonly,
        // we're in the middle of processing someone else's incoming
        // offer (setRemoteDescription moves the connection to
        // "have-remote-offer", not "stable"). Without this check,
        // onnegotiationneeded (queued from the addTrack calls above,
        // which fires as a microtask shortly after) can try to create
        // ITS OWN offer while we're simultaneously trying to answer
        // theirs — an invalid state transition that silently corrupts
        // the connection. This was the actual reason a participant could
        // connect but never receive the host's video/screen share: the
        // negotiation got stuck on their (answering) side specifically.
        if (pc.signalingState !== "stable" || processingOfferRef.current[socketId]) return;
        try {
          makingOfferRef.current[socketId] = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketRef.current?.emit("webrtc:offer", { to: socketId, sdp: offer });
        } catch {
          // Benign — can race with an incoming offer; the glare handling
          // in the webrtc:offer listener below resolves that case.
        } finally {
          makingOfferRef.current[socketId] = false;
        }
      };

      pc.ontrack = (event) => {
        const incomingStream = event.streams[0] ?? null;
        const incomingTrackId = event.track.id;
        const isVideo = event.track.kind === "video";
        setPeers((prev) => {
          const existing =
            prev[socketId] ??
            ({
              socketId,
              userId,
              name,
              stream: null,
              screenStream: null,
              cameraTrackId: null,
              micOn: true,
              cameraOn: true,
              handRaised: false,
            } satisfies RemotePeer);

          // Audio has no screen-share equivalent here (getDisplayMedia is
          // requested video-only — see startScreenShare) — any audio
          // track always belongs to the camera stream, no identification
          // needed.
          if (!isVideo) {
            return { ...prev, [socketId]: { ...existing, stream: incomingStream } };
          }

          // The first VIDEO track we ever see for a peer is their camera
          // (added when the connection was first created) — remember its
          // track id specifically, not the MediaStream wrapper's id. Any
          // later ontrack firing for that SAME track id just means the
          // browser re-wrapped it in a new MediaStream object during
          // renegotiation (which starting/stopping a screen share
          // triggers for every peer connection) — update `stream` to the
          // fresh wrapper, but it's still the camera, not a new share.
          // Only a genuinely different video track id is the screen share.
          if (!existing.cameraTrackId || incomingTrackId === existing.cameraTrackId) {
            return { ...prev, [socketId]: { ...existing, stream: incomingStream, cameraTrackId: incomingTrackId } };
          }
          return { ...prev, [socketId]: { ...existing, screenStream: incomingStream } };
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          removePeer(socketId);
        }
      };

      pcsRef.current[socketId] = pc;
      setPeers((prev) => ({
        ...prev,
        [socketId]: prev[socketId] ?? { socketId, userId, name, stream: null, screenStream: null, cameraTrackId: null, micOn: true, cameraOn: true, handRaised: false },
      }));
      return pc;
    },
    [removePeer],
  );

  useEffect(() => {
    const token = getToken();
    if (!enabled || !token || !roomToken) return;

    // Connects directly to the standalone socket server (see
    // ../../../socket-server — a separate project/deployment, not this
    // Next.js app), since Socket.IO needs a persistent process this app's
    // environment doesn't provide. Falls back to same-origin only if the
    // env var isn't set, which only works in a local dev setup where both
    // happen to run on the same host.
    const configuredUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
    const socketUrl = configuredUrl || undefined;
    const socket = io(socketUrl, {
      path: "/api/socket",
      auth: { token, roomToken },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      console.info("[Veyra] Socket connected", socket.id, "via", socket.io.engine.transport.name);
    });
    socket.on("connect_error", (error) => {
      setConnected(false);
      const socketError = error as Error & { description?: string };
      console.error("[Veyra] Socket connection failed", {
        url: socketUrl ?? window.location.origin,
        message: socketError.message,
        description: socketError.description,
      });
    });
    socket.on("disconnect", (reason) => {
      setConnected(false);
      console.warn("[Veyra] Socket disconnected", reason);
    });

    socket.on(
      "room:peers",
      (existingPeers: { socketId: string; userId: number; name: string }[]) => {
        // Just create the connections — adding the local tracks inside
        // createPeerConnection triggers onnegotiationneeded automatically,
        // which sends the actual offer. Calling createOffer() explicitly
        // here too would race with that and send a duplicate/conflicting
        // offer (glare) on the very first connection attempt.
        for (const peer of existingPeers) {
          createPeerConnection(peer.socketId, peer.userId, peer.name);
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
        [socketId]: prev[socketId] ?? { socketId, userId, name, stream: null, screenStream: null, cameraTrackId: null, micOn: true, cameraOn: true, handRaised: false },
      }));
      callbacksRef.current.onPeerJoined?.({ socketId, userId, name });
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
        // Set synchronously, before any await below — see the ref's own
        // comment for why the timing here matters.
        processingOfferRef.current[from] = true;

        try {
          // Glare: both sides can now initiate a renegotiation (see
          // onnegotiationneeded above), so it's possible we're already
          // mid-createOffer to this same peer when their offer arrives.
          // Standard resolution: designate whichever side has the lower
          // userId as "polite" — the polite side rolls back its own
          // in-flight offer and accepts theirs; the impolite side ignores
          // the incoming offer and lets its own proceed. Both peers
          // compute this the same way independently, so they always
          // agree on who backs off.
          const offerCollision =
            makingOfferRef.current[from] === true || pc.signalingState !== "stable";
          const polite = (myUserIdRef.current ?? 0) < fromUserId;
          const ignoreOffer = !polite && offerCollision;
          if (ignoreOffer) return;

          if (offerCollision) {
            await Promise.all([
              pc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit),
              pc.setRemoteDescription(new RTCSessionDescription(sdp)),
            ]);
          } else {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("webrtc:answer", { to: from, sdp: answer });
        } finally {
          processingOfferRef.current[from] = false;
        }
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

    socket.on(
      "peer:hand-raised",
      ({ socketId, raised }: { socketId: string; raised: boolean }) => {
        setPeers((prev) => (prev[socketId] ? { ...prev, [socketId]: { ...prev[socketId], handRaised: raised } } : prev));
      },
    );

    // Explicit signal for screen-share starting/stopping — the actual
    // video shows up via the normal WebRTC track/ontrack flow above, but
    // relying on track-removal events alone to know when a share has
    // *stopped* is unreliable across browsers and can leave a frozen
    // last-frame tile behind. This gives an immediate, clean signal to
    // remove that tile the instant sharing actually stops.
    socket.on(
      "peer:screen-share-state",
      ({ socketId, sharing }: { socketId: string; sharing: boolean }) => {
        setPeers((prev) =>
          prev[socketId]
            ? { ...prev, [socketId]: { ...prev[socketId], screenStream: sharing ? prev[socketId].screenStream : null } }
            : prev,
        );
      },
    );

    socket.on("peer:reaction", ({ emoji, name }: { emoji: string; name: string }) => {
      callbacksRef.current.onReaction?.(emoji, name);
    });

    socket.on(
      "peer:chat-message",
      ({ text, name, userId, at }: { text: string; name: string; userId: number; at: number }) => {
        callbacksRef.current.onChatMessage?.({ text, fromName: name, fromUserId: userId, at });
      },
    );

    socket.on("peer:left", ({ socketId, userId: leftUserId }: { socketId: string; userId: number }) => {
      removePeer(socketId);
      callbacksRef.current.onPeerLeft?.({ socketId, userId: leftUserId });
    });

    socket.on("participant:force-muted", ({ userId: mutedUserId }: { userId: number }) => {
      // Update that person's tile for everyone watching...
      setPeers((prev) => {
        const entry = Object.entries(prev).find(([, p]) => p.userId === mutedUserId);
        if (!entry) return prev;
        const [socketId, peer] = entry;
        return { ...prev, [socketId]: { ...peer, micOn: false } };
      });
      // ...and if it was *me*, tell the room page to actually disable my track.
      if (mutedUserId === myUserIdRef.current) {
        callbacksRef.current.onForceMuted?.();
      }
    });

    socket.on("participant:force-unmuted", ({ userId: targetUserId }: { userId: number }) => {
      // Deliberately does NOT set micOn: true here. Releasing the lock
      // isn't the same as the mic actually being on — the participant
      // still has to click their own mic button (see onForceUnmuted in
      // the room page, which only clears the lock, not the track). If
      // this set micOn: true optimistically, everyone else's view would
      // show them as "on" — rendering their audio/video tile as live —
      // while the actual track stays disabled, which is exactly what
      // produced the black camera tile bug. The real on/off state only
      // ever comes from their own peer:media-state broadcast, once they
      // actually toggle it themselves.
      if (targetUserId === myUserIdRef.current) callbacksRef.current.onForceUnmuted?.();
    });

    socket.on("participant:force-camera-off", ({ userId: targetUserId }: { userId: number }) => {
      setPeers((prev) => {
        const entry = Object.entries(prev).find(([, p]) => p.userId === targetUserId);
        if (!entry) return prev;
        const [socketId, peer] = entry;
        return { ...prev, [socketId]: { ...peer, cameraOn: false } };
      });
      if (targetUserId === myUserIdRef.current) {
        callbacksRef.current.onForceCameraOff?.();
      }
    });

    socket.on("participant:force-camera-on", ({ userId: targetUserId }: { userId: number }) => {
      // Deliberately does NOT set cameraOn: true here — see the comment
      // on participant:force-unmuted above, same reasoning exactly. This
      // was the actual bug: setting cameraOn: true optimistically here
      // made every viewer's tile for this person render the <video>
      // element (cameraOn && stream both true) while their real track
      // was still disabled — producing a black tile instead of the
      // avatar, right after the host released a lock and before the
      // participant had actually turned their camera back on.
      if (targetUserId === myUserIdRef.current) callbacksRef.current.onForceCameraOn?.();
    });

    socket.on("meeting:mute-all", ({ userIds }: { userIds: number[] }) => {
      const targetSet = new Set(userIds);
      setPeers((prev) => {
        const next = { ...prev };
        for (const [socketId, peer] of Object.entries(prev)) {
          if (targetSet.has(peer.userId)) next[socketId] = { ...peer, micOn: false };
        }
        return next;
      });
      if (myUserIdRef.current !== null && targetSet.has(myUserIdRef.current)) {
        callbacksRef.current.onForceMuted?.();
      }
    });

    socket.on("meeting:unmute-all", ({ userIds }: { userIds: number[] }) => {
      // See the comment in participant:force-unmuted above — this
      // deliberately never sets micOn on peers, only fires the callback
      // for whichever of these is *me*.
      if (myUserIdRef.current !== null && userIds.includes(myUserIdRef.current)) callbacksRef.current.onForceUnmuted?.();
    });

    socket.on("meeting:camera-off-all", ({ userIds }: { userIds: number[] }) => {
      const targetSet = new Set(userIds);
      setPeers((prev) => {
        const next = { ...prev };
        for (const [socketId, peer] of Object.entries(prev)) {
          if (targetSet.has(peer.userId)) next[socketId] = { ...peer, cameraOn: false };
        }
        return next;
      });
      if (myUserIdRef.current !== null && targetSet.has(myUserIdRef.current)) {
        callbacksRef.current.onForceCameraOff?.();
      }
    });

    socket.on("meeting:camera-on-all", ({ userIds }: { userIds: number[] }) => {
      // See the comment in participant:force-camera-on above — this is
      // the bulk version of the exact same fix.
      if (myUserIdRef.current !== null && userIds.includes(myUserIdRef.current)) {
        callbacksRef.current.onForceCameraOn?.();
      }
    });

    socket.on(
      "join-request:new",
      (request: { requestId: number; userId: number; name: string }) => {
        callbacksRef.current.onJoinRequest?.(request);
      },
    );

    socket.on("meeting:removed", () => {
      callbacksRef.current.onRemoved?.();
    });

    socket.on("meeting:ended", () => {
      callbacksRef.current.onMeetingEnded?.();
    });

    return () => {
      Object.keys(pcsRef.current).forEach(removePeer);
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomToken, enabled]);

  const broadcastMediaState = useCallback((micOn: boolean, cameraOn: boolean) => {
    socketRef.current?.emit("peer:media-state", { micOn, cameraOn });
  }, []);

  const broadcastHandRaise = useCallback((raised: boolean) => {
    socketRef.current?.emit("peer:hand-raised", { raised });
  }, []);

  /** Fire-and-forget emoji reaction, broadcast to everyone else in the
   *  room — purely ephemeral, not persisted anywhere. */
  const sendReaction = useCallback((emoji: string) => {
    socketRef.current?.emit("peer:reaction", { emoji });
  }, []);

  /**
   * Swaps the outgoing video track on every current peer connection —
   * what screen sharing is built on. Rather than opening a second video
   * stream alongside the camera, sharing *replaces* the one outgoing video
   * track everyone already receives, via RTCRtpSender.replaceTrack. That
   * keeps the "one video feed per participant" model this app already has
   * (VideoTile only ever renders one stream per tile); the trade-off is
   * you can't show your camera and your screen at the same time — sharing
   * takes over the video slot until you stop.
   *
   * Falls back to addTrack for a peer connection that has no video sender
   * yet (e.g. camera permission was denied so no video track was ever
   * attached) — otherwise replaceTrack on a connection with no video
   * sender at all would silently do nothing.
   */
  const sendChatMessage = useCallback((text: string) => {
    socketRef.current?.emit("peer:chat-message", { text });
  }, []);

  /**
   * Adds the screen-share track as a NEW, separate sender on every peer
   * connection — the camera's sender is untouched. This is what makes
   * the screen show up as its own tile on the receiving end (matching
   * Meet) instead of replacing the camera feed. Triggers
   * onnegotiationneeded automatically (see createPeerConnection above),
   * which is what actually gets it to the other side.
   */
  const addScreenShareTrack = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    Object.values(pcsRef.current).forEach((pc) => {
      const sender = pc.addTrack(track, stream);
      tuneSender(sender, "video", true);
    });
  }, []);

  /**
   * Removes the screen-share sender from every peer connection (found by
   * matching the track itself, since it's a distinct sender from the
   * camera one). Also triggers renegotiation.
   */
  const removeScreenShareTrack = useCallback((track: MediaStreamTrack) => {
    Object.values(pcsRef.current).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track === track);
      if (sender) {
        pc.removeTrack(sender);
      }
    });
  }, []);

  const broadcastScreenShareState = useCallback((sharing: boolean) => {
    socketRef.current?.emit("peer:screen-share-state", { sharing });
  }, []);

  return {
    peers: Object.values(peers),
    connected,
    broadcastMediaState,
    addScreenShareTrack,
    removeScreenShareTrack,
    broadcastScreenShareState,
    broadcastHandRaise,
    sendReaction,
    sendChatMessage,
  };
}
