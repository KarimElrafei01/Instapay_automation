import { Controller, Get, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PlatformEventLogger } from "../observability/platform-event-logger.js";

@Controller("v1/security")
export class HttpSecurityController {
  public constructor(private readonly events: PlatformEventLogger) {}

  @Get("csrf-token")
  public issueCsrfToken(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): { data: { csrfToken: string } } {
    const csrfToken = reply.generateCsrf();
    this.events.record({ action: "csrf_token_issued", outcome: "completed", requestId: request.id });
    return { data: { csrfToken } };
  }
}
