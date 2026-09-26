import { Inject, Injectable } from "@nestjs/common";
import { decidePaymentMatch, type MatchDecision } from "../domain/payment-matching.js";
import { PAYMENT_MATCHING_REPOSITORY, type PaymentMatchingRepository } from "../domain/payment-matching.ports.js";

@Injectable()
export class MatchPaymentAttemptUseCase {
  public constructor(@Inject(PAYMENT_MATCHING_REPOSITORY) private readonly repository: PaymentMatchingRepository) {}

  public async execute(attemptId: string, evaluatedAt = new Date()): Promise<MatchDecision | null> {
    const attempt = await this.repository.findAttemptForMatch(attemptId);
    if (!attempt) return null;
    const decision = decidePaymentMatch(attempt, await this.repository.findUnallocatedAlertsForAttempt(attempt), evaluatedAt);
    const persisted = await this.repository.persistDecision(attempt, decision, evaluatedAt);
    if (!persisted.allocationWon && decision.outcome === "automatically_approved") return null;
    return decision;
  }
}

@Injectable()
export class MatchNewAlertUseCase {
  public constructor(
    @Inject(PAYMENT_MATCHING_REPOSITORY) private readonly repository: PaymentMatchingRepository,
    private readonly matchAttempt: MatchPaymentAttemptUseCase,
  ) {}

  public async execute(alertId: string): Promise<void> {
    for (const attemptId of await this.repository.findAwaitingAttemptIdsForAlert(alertId)) await this.matchAttempt.execute(attemptId);
  }
}
