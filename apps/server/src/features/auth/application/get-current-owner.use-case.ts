import { Inject, Injectable } from "@nestjs/common";
import {
  OWNER_REPOSITORY,
  OWNER_SESSION_REPOSITORY,
  type Owner,
  type OwnerRepository,
  type OwnerSessionRepository,
} from "../domain/ports.js";

@Injectable()
export class GetCurrentOwnerUseCase {
  public constructor(
    @Inject(OWNER_REPOSITORY) private readonly owners: OwnerRepository,
    @Inject(OWNER_SESSION_REPOSITORY) private readonly sessions: OwnerSessionRepository,
  ) {}

  public async execute(sessionToken: string | undefined): Promise<Owner | null> {
    if (!sessionToken) {
      return null;
    }
    const session = await this.sessions.findByToken(sessionToken);
    return session ? this.owners.findById(session.ownerId) : null;
  }
}
