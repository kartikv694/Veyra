# Veyra — Multi-Participant Video Meeting System

A web-based meeting platform where more than two users can join the same
room, communicate over audio/video, share their screens, and be managed by
a designated host. Built against the project SRS with a **12 September
2026** delivery deadline, targeting internal completion by **9 September**.

## Tech stack

| Layer          | Technology                              |
|----------------|------------------------------------------|
| Frontend       | Next.js 16 (App Router) + TypeScript     |
| UI             | Tailwind CSS v4                          |
| Backend/API    | Next.js Route Handlers (Node.js runtime) |
| Real-time      | Socket.IO (signaling) + WebRTC (media)   |
| Auth           | JWT (`jsonwebtoken` + `bcryptjs`)        |
| Database       | PostgreSQL (Neon)                        |
| ORM            | Prisma 7 (`@prisma/adapter-pg`)          |
| Validation     | Zod                                      |

## Getting started

```bash
npm install
npx prisma generate                              # generate the Prisma client
npx prisma migrate dev --name init_meeting_schema # apply the schema to your DB
npm run dev
```

`npm run dev`, `npm run build`, and `npm run start` are now plain
`next dev` / `next build` / `next start` — no custom server. Real-time
signaling (Socket.IO) is a **separate project**, `../socket-server`
(a sibling folder, outside this one), run and deployed independently. See
`../socket-server/README.md`. You'll need that running too for the meeting
room's audio/video to work; everything else (auth, dashboard, REST API)
works without it.

Open <http://localhost:3000> — it redirects to `/login`.

### Environment variables (`.env`)

| Variable                        | Purpose                                                              |
|----------------------------------|------------------------------------------------------------------------|
| `DATABASE_URL`                   | Postgres connection string (Neon or any Postgres ≥ 15).               |
| `JWT_SECRET`                     | Signs/verifies auth tokens. Generate with `openssl rand -base64 48`.  |
| `APP_URL`                        | Base URL used to build shareable meeting links from a room token.     |
| `SOCKET_SERVER_URL`              | Base URL of `../socket-server`, e.g. `http://localhost:4000`.         |
| `SOCKET_SERVER_INTERNAL_SECRET`  | Must match `INTERNAL_EMIT_SECRET` in `../socket-server/.env`.         |
| `NEXT_PUBLIC_SOCKET_URL`         | Same socket server, but the public URL the *browser* connects to.     |

## Project structure

```
../socket-server/       Standalone Socket.IO signaling server (separate project — see its README)
src/
  app/
    login/           Sign-in page (wired to the API, cross-redirects to signup)
    signup/          Account creation page (wired, cross-redirects to login)
    dashboard/        Create/join meeting UI, auth-guarded, reads landing intent
    room/[token]/      Meeting room screen — video tiles, participant list, controls
    api/
      auth/
        signup/       POST — create account + issue token
        login/         POST — verify credentials + issue token
        me/             GET — verify token + return current user
      rooms/
        route.ts       POST — create meeting · GET — list caller's meetings
        [token]/         GET — meeting details + participant roster
          end/             POST — host ends the meeting for everyone
          lock/             PATCH — host locks/unlocks new-participant access
          participants/[userId]/
            mute/             POST — host force-mutes a participant
            remove/            POST — host removes a participant
        join/           POST — join a meeting by room token
        leave/           POST — leave a meeting
  components/
    ThemeProvider.tsx   Light/dark theme context (persisted, respects OS preference)
    ThemeToggle.tsx      The toggle switch itself
    SignalMotif.tsx       Decorative animated node graph on the auth screens
    BrandMark.tsx          Veyra logo mark
    AppToaster.tsx          Toast notification viewport (sonner), theme-matched
    VideoTile.tsx           One participant's tile (local or real remote WebRTC stream)
    ControlBar.tsx           Mic/camera/screen-share/participants/leave/host controls
    ParticipantList.tsx      Slide-over roster panel with host mute/remove actions
  hooks/
    useMeetingRoom.ts        Socket.IO signaling + full-mesh WebRTC peer connections
  lib/
    prisma.ts            Prisma client singleton (hot-reload safe)
    auth.ts               Password hashing + JWT sign/verify + route guard (server)
    auth-client.ts         Session storage + checkAuth() (client)
    room-code.ts            Room token generation ("xxx-xxx-xxx") + link builder
    host-action.ts           Shared host/target validation for mute + remove routes
    socket-emitter.ts         Access to the shared Socket.IO instance from REST routes
  generated/prisma/         Prisma's generated client (not committed by convention)
prisma/
  schema.prisma            Data model — see below
postman/
  Veyra.postman_collection.json   Import this to test every REST endpoint below
                                   (Socket.IO isn't REST, so it isn't in here —
                                   see Real-time signaling & WebRTC instead)
```

## Auth-gated navigation flow

The landing page (`/`) leads with the two things people actually came to
do — **New meeting** / **Join meeting** — instead of a login/signup choice.
Clicking either runs a background check (`GET /api/auth/me`, via
`checkAuth()` in `src/lib/auth-client.ts`) rather than trusting a token's
mere presence in localStorage:

- **Already signed in** → straight to `/dashboard?intent=create` (or
  `=join`). The dashboard reads that intent once — `create` auto-starts
  room creation, `join` focuses the join-code field — then discards it.
- **Not signed in** → the intent is stashed in localStorage (key
  `veyra_intent`) and the visitor is sent to `/login`. After a successful
  login/signup they land on `/dashboard`, which checks localStorage for the
  stashed intent as a fallback (since a redirect through `/login` doesn't
  carry a query string along).

**Login ↔ signup cross-redirect:** rather than a dead-end error, a failed
login/signup routes you to the other form with the email pre-filled:
- Login with an email that isn't registered (`404`, `reason:
  "not_registered"`) → toast + redirect to `/signup?email=...`.
- Signup with an email that's already registered (`409`, `reason:
  "already_registered"`) → toast + redirect to `/login?email=...`.

**Toasts:** all user-facing success/error feedback goes through
[sonner](https://sonner.emilkowal.ski/) (`toast.success` / `toast.error` /
`toast.info`), mounted once in `layout.tsx` via `AppToaster` and themed to
match whatever light/dark mode is active.

**Route guards:** `/dashboard` and `/room/[token]` both run `checkAuth()`
on mount and redirect to `/login` if it comes back empty — so a bookmarked
or directly-typed URL can't render a page whose API calls would just fail
with 401s.

## Meeting room UI

`/room/[token]` is the actual meeting screen: a video tile grid, a
participant list panel, and a bottom control bar (mic, camera, screen
share, participants toggle, leave) — components live in `src/components/`
as `VideoTile`, `ControlBar`, `ParticipantList`.

Two data sources feed the tiles, on purpose kept separate:
- The **DB roster** (`GET /api/rooms/[token]`, polled periodically) — the
  durable "who's actually a participant" list. Drives the participant
  panel, host badges, and detecting when the meeting has ended.
- The **live peer set** (`useMeetingRoom`, below) — who's actually
  connected *right now*, with a real audio/video `MediaStream` once their
  connection finishes negotiating. A roster entry with no live peer yet
  just means they're still connecting; the tile falls back to an
  avatar-initials placeholder automatically.

Screen sharing is real: clicking the button captures your screen
(`getDisplayMedia`) and swaps it in as your outgoing video track on every
peer connection (`replaceVideoTrack` in `useMeetingRoom`) — everyone else
just sees your screen where your camera was, no separate signaling path
needed since it reuses the same video slot. Stopping (via the button or
the browser's own native "Stop sharing" control) reverts to your camera.
One video feed per participant at a time is the trade-off — you can't
show camera and screen simultaneously.

The "active speaker" ring (SRS: "Show the current active speaker") is
real too, but implemented per-tile rather than centrally: each `VideoTile`
runs its own Web Audio analysis on whatever `MediaStream` it's showing and
lights its own ring when that stream's volume clears a threshold — a
volume reading, not true voice-activity detection, so a loud non-speech
sound can trigger it too.

## Real-time signaling & WebRTC

Two pieces work together:

- **`../socket-server/server.ts`** — a standalone Node server, a separate
  project from this one (see [Getting started](#getting-started) and
  `../socket-server/README.md`). It runs a Socket.IO server at
  `/api/socket`. Every socket connection must present a valid auth token
  *and* the room token it wants to join; the server independently verifies
  (via the database) that the connecting user is currently an active
  participant of that specific meeting before letting them in — the same
  access rule the REST API enforces, applied again at the socket layer so
  it can't be bypassed by going around the REST endpoints.

- **`src/hooks/useMeetingRoom.ts`** (client) — connects to that socket and
  maintains a **full-mesh** set of `RTCPeerConnection`s: one direct
  connection to every other participant currently in the call, each
  carrying your local audio/video tracks and receiving theirs. Handshake:
  a newcomer is told who's already in the room and sends each of them an
  offer; everyone else waits for that offer, answers it, and both sides
  exchange ICE candidates (via a public STUN server) until connected.
  Live mic/camera toggle state is broadcast over the socket as well —
  deliberately *not* written to `Participant.isMuted` in the database,
  since it's ephemeral connection state, not a durable record.

**Known limitation, by design for now:** mesh topology means each
participant's upload bandwidth grows with the number of others in the
call — fine for a handful of people, not for a large meeting. The SRS's
own tech stack table names the standard fix (a media server — LiveKit or
Mediasoup) for exactly this reason; swapping one in later means replacing
`useMeetingRoom`, not the room page or `VideoTile`, since both only
consume the `peers` it returns. Also worth knowing: only a STUN server is
configured, which resolves most home/office networks but not every
restrictive NAT/firewall — a TURN server (relaying media when a direct
connection can't be established) would be the next thing to add for
reliability outside a controlled testing environment.

## Host controls & participant management

Covers the remaining host-facing SRS items: mute participants, remove
participants, control meeting access, end the meeting. All four are
REST endpoints under `/api/rooms/[token]/...` (full request/response
shapes in [API reference](#api-reference)), each independently checking
`meeting.hostId === caller` — a non-host calling any of them gets `403`
regardless of what the UI shows.

What makes these feel immediate rather than "wait for the next poll":
right after the database write, route handlers call the socket server's
internal HTTP API (see `src/lib/socket-emitters.ts` and
`../socket-server/server.ts`) to push an event straight to the affected
client(s):
- **Mute** → `participant:force-muted` to the whole room, so the muted
  person's client disables its own mic track and everyone else's view of
  that tile updates, in the same instant.
- **Remove** → `meeting:removed` to that person specifically, then their
  socket is force-disconnected — which fires the ordinary disconnect
  cleanup, so their tile disappears for everyone the same way it would if
  they'd left on their own.
- **End meeting** → `meeting:ended` to everyone in the room.
- **Lock** doesn't need a push — it only changes what a *future*
  `POST /api/rooms/join` call will do, so there's nothing to tell anyone
  right now.

In the UI, these live in `ParticipantList` (per-row mute/remove buttons,
visible only to the host, on hover) and the room page's host options menu
("More options" → lock/unlock, set/change passcode, end for everyone —
host-only).

The one gap worth knowing about, not papered over: **remove isn't a ban.**
See the endpoint's own doc comment and the API reference entry above —
short version, a removed person's `Participant` row still exists, so
rejoining treats them as returning and lets them straight back in unless
the meeting is also locked.

## Meeting security

Beyond `locked` (above), meetings can also have an optional **passcode**
(`Meeting.passcode`, host-set via `PATCH /api/rooms/[token]/passcode`,
same "only gates first-time joins" rule as `locked`). The reasoning: a
room token is already unguessable, but a link can get forwarded on by
someone who didn't mean to grant access — a passcode is a second,
separately-shared secret for meetings that need that extra layer. The
dashboard's join form only shows the passcode field once the server's
first response says one's needed, rather than always showing it.

Also here: **login rate limiting** (`src/lib/rate-limit.ts`) — 10 attempts
per 15 minutes per IP against `/api/auth/login`, to slow down password
guessing. It's an in-memory counter, so it only coordinates within a
single process; noted in the file itself as insufficient for a real
multi-instance deployment (would need Redis or similar there).

## Data model

Three models in `prisma/schema.prisma` (each fully documented in-file with
`///` doc comments):

- **User** — account record: `email` (unique, login identifier), `username`,
  `name`, hashed `password`. Relates to the meetings they've hosted
  (`meetingsHosted`) and every meeting they've ever joined (`participations`).
- **Meeting** — one video call room. `token` is the unique, shareable room
  code; the full join link is *derived* from it (`APP_URL/room/<token>`)
  rather than duplicated in the database. `hostId` points at the creator.
  `endAt` is `null` while the meeting is live and gets set when it ends.
  `locked` blocks new (never-joined-before) participants from joining while
  true — host-controlled access, doesn't affect anyone already in.
- **Participant** — join table between `User` and `Meeting`. One row per
  user per meeting (`@@unique([meetingId, userId])`), carrying `isHost`,
  `isMuted`, `joinedAt`, and `leftAt` (`null` while still connected) so the
  meeting-room UI can render participant tiles and host controls directly
  from this table.

## API reference

All endpoints live under `/api`. Protected endpoints require:

```
Authorization: Bearer <token>
```

where `<token>` comes from the `signup` or `login` response.

### `POST /api/auth/signup`
Create an account and receive a token.

**Request**
```json
{
  "name": "Ayesha Khan",
  "email": "ayesha@example.com",
  "password": "supersecret123",
  "username": "ayesha"
}
```
**201 response**
```json
{
  "user": { "id": 1, "name": "Ayesha Khan", "email": "ayesha@example.com", "username": "ayesha", "createdAt": "2026-09-03T10:00:00.000Z" },
  "token": "eyJhbGciOi..."
}
```
`400` on invalid input, `409` `{ "error": "...", "reason": "already_registered" }` if the email is already registered.

### `POST /api/auth/login`
**Request**
```json
{ "email": "ayesha@example.com", "password": "supersecret123" }
```
**200 response** — same shape as signup's.

Unlike signup, this endpoint *does* distinguish the failure reason (a
deliberate product trade-off for the redirect flow above, not an
oversight):
- `404` `{ "error": "No account found with that email.", "reason": "not_registered" }`
- `401` `{ "error": "Incorrect password.", "reason": "invalid_password" }`

### `POST /api/auth/me`  *(auth required)*
Verifies the bearer token against the database and returns the current
user — the "am I still logged in" check the frontend runs before letting
someone through a gated action.

**200 response**
```json
{ "user": { "id": 1, "name": "Ayesha Khan", "email": "ayesha@example.com", "username": "ayesha", "createdAt": "..." } }
```
`401` if the token is missing, invalid, expired, or its account no longer exists.

### `POST /api/rooms`  *(auth required)*
Creates a meeting; caller becomes host automatically. No request body.

**201 response**
```json
{
  "meeting": {
    "id": 1,
    "token": "7fk-2xa-plm",
    "link": "http://localhost:3000/room/7fk-2xa-plm",
    "createdAt": "2026-09-03T10:05:00.000Z",
    "hostId": 1
  }
}
```

### `GET /api/rooms`  *(auth required)*
Lists every meeting the caller hosts or has joined, most recent first —
backs the dashboard's "Recent meetings" list.

**200 response**
```json
{
  "meetings": [
    {
      "id": 1,
      "token": "7fk-2xa-plm",
      "link": "http://localhost:3000/room/7fk-2xa-plm",
      "createdAt": "2026-09-03T10:05:00.000Z",
      "endAt": null,
      "isHost": true,
      "participantCount": 1
    }
  ]
}
```

### `GET /api/rooms/[token]`  *(auth required)*
Meeting details plus the full participant roster — what the meeting-room
screen (`/room/[token]`) polls to render video tiles and the participant
list. Restricted to people who have actually joined this specific meeting.

**200 response**
```json
{
  "meeting": { "id": 1, "token": "7fk-2xa-plm", "createdAt": "...", "endAt": null, "hostId": 1 },
  "participants": [
    { "userId": 1, "name": "Ayesha Khan", "email": "ayesha@example.com", "isHost": true, "isMuted": false, "joinedAt": "...", "leftAt": null }
  ]
}
```
`403` if the caller has never joined this meeting, `404` if the token doesn't match one.

### `POST /api/rooms/join`  *(auth required)*
**Request**
```json
{ "token": "7fk-2xa-plm", "passcode": "letmein" }
```
`passcode` is only needed if the meeting has one set (`passcodeSet` from
`GET /api/rooms/[token]`) and you're joining for the first time.

**200 response**
```json
{
  "meeting": { "id": 1, "token": "7fk-2xa-plm", "link": "...", "createdAt": "...", "hostId": 1 },
  "participant": { "id": 2, "isHost": false, "isMuted": false, "joinedAt": "2026-09-03T10:07:00.000Z" }
}
```
`404` if the token doesn't match any meeting, `410` if the meeting has
already ended, `401` if the passcode is missing or wrong. **Returning
participants** (anyone who's already joined this meeting before,
including the host reconnecting) are always let back in — this just
clears `leftAt`. **First-time joins** are only admitted while the host is
currently active in the meeting (and the meeting isn't locked, and the
passcode matches if one's set); otherwise `403`/`401` as appropriate.

### `POST /api/rooms/leave`  *(auth required)*
**Request**
```json
{ "token": "7fk-2xa-plm" }
```
**200 response**
```json
{
  "meeting": { "id": 1, "token": "7fk-2xa-plm", "hostId": 1 },
  "wasHost": true
}
```
**Design note — host leaving:** `Meeting.hostId` is a permanent identity,
not a live role, so it's never reassigned here and the meeting is never
auto-ended just because the host left. A leaving host's `isHost` flag on
their participant row stays `true` — it represents their standing role,
not whether they're currently connected — so when they rejoin they get
full host rights back immediately, no restriction. While the host is away,
existing participants can keep leaving and rejoining freely; the only
thing host absence blocks is a *brand-new* person joining for the first
time (see `/api/rooms/join`). `404` if the token doesn't match a meeting,
or if the caller isn't currently an active participant in it.

### `PATCH /api/rooms/[token]/lock`  *(auth required, host only)*
Toggles whether new (never-joined-before) participants can join at all —
SRS: "control meeting access." Doesn't affect anyone already in.

**Request**
```json
{ "locked": true }
```
**200 response**
```json
{ "meeting": { "id": 1, "token": "7fk-2xa-plm", "locked": true } }
```
`403` if the caller isn't the host.

### `PATCH /api/rooms/[token]/passcode`  *(auth required, host only)*
Sets or clears a secondary access secret — SRS: "Meeting Security."
Same "only gates first-time joins" rule as `locked`.

**Request**
```json
{ "passcode": "letmein" }
```
Send `{ "passcode": null }` (or `""`) to remove it.

**200 response**
```json
{ "meeting": { "id": 1, "token": "7fk-2xa-plm", "passcodeSet": true } }
```
`400` if a non-null passcode is under 4 characters, `403` if the caller
isn't the host.

### `POST /api/rooms/[token]/participants/[userId]/mute`  *(auth required, host only)*
Force-mutes another active participant — SRS: "Host can mute participants"
/ "allow/disable participant speaking" (same mechanism covers both here).
One-directional: the host can mute, but can't force someone *unmuted* —
only that person's own control can turn their mic back on.

**200 response**
```json
{ "muted": 2 }
```
`400` if targeting yourself or an invalid id, `403` if the caller isn't
the host, `404` if that person isn't currently in the meeting.

### `POST /api/rooms/[token]/participants/[userId]/remove`  *(auth required, host only)*
Removes another active participant — SRS: "Host can ... remove
participants." Sets their `leftAt`, notifies them in real time, and
disconnects their socket (which cleanly tears down their peer connections
for everyone else too).

**200 response**
```json
{ "removed": 2 }
```
Same error codes as mute. **Known limitation:** this doesn't ban the
person — since their `Participant` row still exists, a follow-up
`POST /api/rooms/join` treats them as *returning* and lets them straight
back in (the host-presence/lock checks only gate first-time joins). Lock
the meeting alongside a removal if it needs to actually stick; there's no
separate "banned" state.

### `POST /api/rooms/[token]/end`  *(auth required, host only)*
Ends the meeting for everyone — SRS: "Host can ... end the meeting." Sets
`endAt` and pushes a real-time `meeting:ended` event so connected clients
leave immediately.

**200 response**
```json
{ "meeting": { "id": 1, "token": "7fk-2xa-plm", "endAt": "2026-09-08T10:00:00.000Z" } }
```
`403` if the caller isn't the host, `409` if it's already ended.

### Testing in Postman
Import `postman/Veyra.postman_collection.json`. Run **Signup** (or
**Login**) once — its test script saves the returned token into the
collection's `{{token}}` variable automatically, so every other request in
the collection is pre-authenticated. **Create room** similarly saves its
`{{roomToken}}` for the **Join room** request.

## Project status

Built incrementally against a compressed schedule (deadline 12 Sept,
internal target 9 Sept):

- [x] **Auth & dashboard UI** — Login/signup/dashboard, light/dark theme toggle
- [x] **Schema** — User / Meeting / Participant data model
- [x] **Auth & room APIs** — signup/login/me + room create/list/join/leave
- [x] **Auth-gated navigation** — landing page with gated create/join, login/signup
      wired to the API with toast alerts and cross-redirects, dashboard wired to
      live room data, placeholder `/room/[token]` for the post-join hand-off
- [x] **Meeting room UI** — video tile grid (real local camera,
      roster-driven remote placeholders), participant list panel, control bar
- [x] **Real-time signaling + WebRTC** — Socket.IO server (`../socket-server/server.ts`) +
      full-mesh peer connections (`useMeetingRoom`); remote tiles now carry
      real audio/video, mic/camera state broadcasts live
- [x] **Host controls & participant management** — mute, remove, end
      meeting, lock access; all four push real-time events to affected
      clients instead of waiting for the next roster poll
- [x] **Screen sharing, meeting security, active speaker detection** —
      real `getDisplayMedia` screen share via track-replacement, per-tile
      Web Audio active-speaker rings, optional meeting passcode, login
      rate limiting
- [ ] Optional chat, polish, final test pass
