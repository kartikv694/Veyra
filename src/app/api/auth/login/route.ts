/**
 * POST /api/auth/login
 *
 * Verifies email + password and returns a fresh auth token.
 *
 * Request body:
 *   { "email": string, "password": string }
 *
 * Responses:
 *   200  { user: { id, name, email, username, createdAt }, token }
 *   400  { error, details }   — validation failed
 *   401  { error }            — email not found or password incorrect
 *
 * Note: on a wrong email vs. a wrong password we return the *same* 401
 * message ("Invalid email or password") rather than distinguishing them —
 * this stops an attacker from using the endpoint to discover which emails
 * are registered.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signAuthToken } from "@/lib/auth";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = user ? await verifyPassword(password, user.password) : false;

  if (!user || !passwordMatches) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = signAuthToken({ sub: user.id, email: user.email });

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      createdAt: user.createdAt,
    },
    token,
  });
}
