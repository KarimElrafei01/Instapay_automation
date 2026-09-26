import { Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

export type PlatformEvent = {
  action: string;
  outcome: "accepted" | "completed" | "denied" | "failed";
  requestId?: string;
  actorOwnerId?: string;
  resourceId?: string;
  reasonCode?: string;
};

@Injectable()
export class PlatformEventLogger {
  public constructor(@InjectPinoLogger(PlatformEventLogger.name) private readonly logger: PinoLogger) {}

  public record(event: PlatformEvent): void {
    this.logger.info({ event }, "platform.event");
  }
}
