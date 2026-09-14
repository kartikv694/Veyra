/**
 * Room token generation.
 *
 * Meeting rooms are identified by a short, shareable code like
 * "7fk-2xa-plm". The full join link is built from APP_URL at request time
 * so the public application URL has one source of truth.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomGroup(length = 3): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function generateRoomToken(): string {
  return `${randomGroup()}-${randomGroup()}-${randomGroup()}`;
}

export async function createUniqueRoomToken(): Promise<string> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const token = generateRoomToken();
    const existing = await prisma.meeting.findUnique({ where: { token } });
    if (!existing) return token;
  }
  throw new Error(`Could not generate a unique room token after ${MAX_ATTEMPTS} attempts.`);
}

/**
 * Returns the canonical public Veyra URL used in emails and API responses.
 *
 * In production APP_URL must be configured (for example:
 * https://veyra-kohl.vercel.app). During local development we retain the
 * localhost fallback so the app remains easy to run with `npm run dev`.
 */
function getAppUrl(): string {
  const configured = process.env.APP_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL is required in production. Set it to the public Veyra application URL.");
  }

  return "http://localhost:3000";
}

/** Builds the full shareable join link from a room token. */
export function buildRoomLink(token: string): string {
  return `${getAppUrl()}/room/${token}`;
}
