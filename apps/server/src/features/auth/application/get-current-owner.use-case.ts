import { Inject, Injectable } from "@nestjs/common";
import {
  OWNER_REPOSITORY,
  OWNER_SESSION_REPOSITORY,
  type Owner,
  type OwnerRepository,
  type OwnerSession,
  type OwnerSessionRepository,
} from "../domain/ports.js";

export type CurrentOwner = {
  owner: Owner;
  session: OwnerSession;
};

@Injectable()
export class GetCurrentOwnerUseCase {
  public constructor(
    @Inject(OWNER_REPOSITORY) private readonly owners: OwnerRepository,
    @Inject(OWNER_SESSION_REPOSITORY) private readonly sessions: OwnerSessionRepository,
  ) {}

  public async execute(sessionToken: string | undefined): Promise<CurrentOwner | null> {
    if (!sessionToken) {
      return null;
    }
    const session = await this.sessions.renew(sessionToken);
    if (!session) {
      return null;
    }
    const owner = await this.owners.findById(session.ownerId);
    return owner ? { owner, session } : null;
  }
}
