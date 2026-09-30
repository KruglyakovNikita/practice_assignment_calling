import { sign } from 'jsonwebtoken';

export function signJwt(params: { orgId: string; sub: string; role: 'worker' | 'authenticated'; secret: string }): string {
  return sign(
    { org_id: params.orgId, role: params.role },
    params.secret,
    { algorithm: 'HS256', subject: params.sub, expiresIn: '1h' }
  );
}
