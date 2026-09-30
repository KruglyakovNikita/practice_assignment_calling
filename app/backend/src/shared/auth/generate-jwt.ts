import 'dotenv/config';
import { z } from 'zod';
import { signJwt } from './sign-jwt';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key?.startsWith('--') || key === '--') continue;
  const value = process.argv[i + 1];
  if (value && !value.startsWith('--')) {
    args.set(key.slice(2), value);
    i += 1;
  }
}

const input = z.object({
  orgId: z.string().uuid(),
  sub: z.string().min(1),
  role: z.enum(['worker', 'authenticated']),
  secret: z.string().min(1)
}).parse({
  orgId: args.get('org-id'),
  sub: args.get('sub'),
  role: args.get('role'),
  secret: process.env.JWT_SECRET
});

const token = signJwt(input);

process.stdout.write(`${token}\n`);
