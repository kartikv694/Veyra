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
| Auth           | JWT (`jsonwebtoken` + `bcryptjs`)        |
| Database       | PostgreSQL (Neon)                        |
| ORM            | Prisma 7 (`@prisma/adapter-pg`)          |
| Validation     | Zod                                      |

Real-time media (WebRTC/Socket.IO, LiveKit/Mediasoup) lands in a later task —
see [Project status](#project-status).

## Getting started

```bash
npm install
npx prisma generate                              # generate the Prisma client
npx prisma migrate dev --name init_meeting_schema # apply the schema to your DB
npm run dev
```

Open <http://localhost:3000> — it redirects to `/login`.

### Environment variables (`.env`)

| Variable       | Purpose                                                              |
|----------------|------------------------------------------------------------------------|
| `DATABASE_URL` | Postgres connection string (Neon or any Postgres ≥ 15).               |
| `JWT_SECRET`   | Signs/verifies auth tokens. Generate with `openssl rand -base64 48`.  |
| `APP_URL`      | Base URL used to build shareable meeting links from a room token.     |

## Project structure

```
src/
  app/
    login/           Sign-in page
    signup/          Account creation page
    dashboard/        Create/join meeting UI
    api/
      auth/
        signup/       POST — create account + issue token
        login/         POST — verify credentials + issue token
      rooms/
        route.ts       POST — create meeting · GET — list caller's meetings
        join/           POST — join a meeting by room token
  components/
    ThemeProvider.tsx   Light/dark theme context (persisted, respects OS preference)
    ThemeToggle.tsx      The toggle switch itself
    SignalMotif.tsx       Decorative animated node graph on the auth screens
    BrandMark.tsx          Veyra logo mark
  lib/
    prisma.ts            Prisma client singleton (hot-reload safe)
    auth.ts               Password hashing + JWT sign/verify + route guard
    room-code.ts            Room token generation ("xxx-xxx-xxx") + link builder
  generated/prisma/         Prisma's generated client (not committed by convention)
prisma/
  schema.prisma            Data model — see below
postman/
  Veyra.postman_collection.json   Import this to test every endpoint below
```

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
`400` on invalid input, `409` if the email is already registered.

### `POST /api/auth/login`
**Request**
```json
{ "email": "ayesha@example.com", "password": "supersecret123" }
```
**200 response** — same shape as signup's. `401` on wrong email/password
(deliberately the same message for both, so the endpoint can't be used to
find out which emails are registered).

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

### `POST /api/rooms/join`  *(auth required)*
**Request**
```json
{ "token": "7fk-2xa-plm" }
```
**200 response**
```json
{
  "meeting": { "id": 1, "token": "7fk-2xa-plm", "link": "...", "createdAt": "...", "hostId": 1 },
  "participant": { "id": 2, "isHost": false, "isMuted": false, "joinedAt": "2026-09-03T10:07:00.000Z" }
}
```
`404` if the token doesn't match any meeting, `410` if the meeting has
already ended. **Returning participants** (anyone who's already joined
this meeting before, including the host reconnecting) are always let back
in — this just clears `leftAt`. **First-time joins** are only admitted
while the host is currently active in the meeting; if the host isn't
present, a brand-new participant gets `403` until the host returns.

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

### Testing in Postman
Import `postman/Veyra.postman_collection.json`. Run **Signup** (or
**Login**) once — its test script saves the returned token into the
collection's `{{token}}` variable automatically, so every other request in
the collection is pre-authenticated. **Create room** similarly saves its
`{{roomToken}}` for the **Join room** request.

## Project status

Built day-by-day against a compressed schedule (deadline 12 Sept, internal
target 9 Sept):

- [x] **Task 1** — Login/signup/dashboard UI, light/dark theme toggle
- [x] **Schema** — User / Meeting / Participant data model
- [x] **Task 2** — Auth (signup/login) + room (create/list/join) APIs
- [ ] Task 3 — Meeting room UI (video tiles, participant list, control bar)
- [ ] Task 4 — Socket.IO signaling + WebRTC/LiveKit integration
- [ ] Task 5 — Host controls (mute/remove/end meeting) + participant management
- [ ] Task 6 — Screen sharing, meeting security, active speaker indicator
- [ ] Task 7 — Optional chat, polish, final test pass
