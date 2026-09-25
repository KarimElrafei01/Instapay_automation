import { Inject, Injectable } from "@nestjs/common";
import {
  OWNER_SESSION_REPOSITORY,
  type OwnerSessionRepository,
} from "../domain/ports.js";

@Injectable()
export class SignOutOwnerUseCase {
  public constructor(
    @Inject(OWNER_SESSION_REPOSITORY) private readonly sessions: OwnerSessionRepository,
  ) {}

  public async execute(sessionToken: string | undefined): Promise<void> {
    if (sessionToken) {
      await this.sessions.revoke(sessionToken);
    }
  }
}
