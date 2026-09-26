import type { FastifyReply } from "fastify";
import type { OwnerSession } from "../domain/ports.js";

export const OWNER_SESSION_COOKIE_NAME = "instapay_owner_session";

export function refreshOwnerSessionCookie(reply: FastifyReply, session: OwnerSession): void {
  reply.setCookie(OWNER_SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
}
