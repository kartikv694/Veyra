/**
 * POST /api/auth/signup
 *
 * Creates a new user account and immediately logs them in (returns a token,
 * same as /api/auth/login would) so the client can go straight from signup
 * to the dashboard without a second request.
 *
 * Request body:
 *   { "name": string, "email": string, "password": string (min 8 chars), "username"?: string }
 *
 * Responses:
 *   201  { user: { id, name, email, username, createdAt }, token }
 *   400  { error, details }   — validation failed
 *   409  { error }            — email already registered
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signAuthToken } from "@/lib/auth";

// Prisma needs the Node.js runtime (not the Edge runtime).
export const runtime = "nodejs";

const signupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  username: z.string().min(3).max(30).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, email, password, username } = parsed.data;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const hashedPassword = await hashPassword(password);

  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword, username },
    // Never return the password hash to the client.
    select: { id: true, name: true, email: true, username: true, createdAt: true },
  });

  const token = signAuthToken({ sub: user.id, email: user.email });

  return NextResponse.json({ user, token }, { status: 201 });
}
