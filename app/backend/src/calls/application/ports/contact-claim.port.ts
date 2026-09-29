export type claimContactCommand = {
  orgId: string;
  campaignId: string;
  tenantToken: string;
};

export type claimedContact = {
  id: string;
  phoneE164: string;
  attemptId: string;
};

export interface contactClaimPort {
  claim(command: claimContactCommand): Promise<claimedContact | null>;
}

export const CONTACT_CLAIM_PORT = Symbol('CONTACT_CLAIM_PORT');
