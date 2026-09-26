import { Global, Module } from "@nestjs/common";
import { PlatformEventLogger } from "./platform-event-logger.js";

@Global()
@Module({ providers: [PlatformEventLogger], exports: [PlatformEventLogger] })
export class ObservabilityModule {}
