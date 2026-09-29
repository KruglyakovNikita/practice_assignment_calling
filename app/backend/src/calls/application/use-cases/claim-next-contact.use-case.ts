import type { claimContactCommand, claimedContact, contactClaimPort } from '../ports/contact-claim.port';

export class ClaimNextContactUseCase {
  constructor(private readonly contacts: contactClaimPort) {}

  execute(command: claimContactCommand): Promise<claimedContact | null> {
    return this.contacts.claim(command);
  }
}
