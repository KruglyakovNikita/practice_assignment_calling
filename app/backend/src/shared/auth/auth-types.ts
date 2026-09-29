export type authRole = 'worker' | 'authenticated';

export type authenticatedPrincipal = {
  sub: string;
  orgId: string;
  role: authRole;
  token: string;
};
