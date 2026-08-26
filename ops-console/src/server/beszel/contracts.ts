import { z } from 'zod';

export const BESZEL_CONTRACT_VERSION = '0.18.8' as const;

const isoOrPocketBaseDate = z.string().min(20).max(40).refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'invalid timestamp',
});
const nonnegative = z.number().finite().nonnegative();
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();
const stateCode = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
]);
const subStateCode = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
]);

const listEnvelope = {
  page: positiveInteger,
  perPage: positiveInteger,
  totalPages: positiveInteger,
  totalItems: z.number().int().nonnegative(),
};

export const authResponseSchema = z.object({
  token: z.string().min(1).max(4096),
  record: z.object({
    id: z.string().min(1).max(64),
    email: z.string().email().max(254),
    role: z.literal('readonly'),
  }),
});

export const hubInfoSchema = z.object({
  v: z.literal(BESZEL_CONTRACT_VERSION),
  cu: z.boolean().optional(),
});

export const systemRecordSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{15}$/u),
  status: z.enum(['up', 'down', 'paused', 'pending']),
  info: z.object({
    t: nonnegativeInteger.optional(),
    u: nonnegative,
    v: z.string().min(1).max(32),
    sv: z.tuple([nonnegativeInteger, nonnegativeInteger]).optional(),
  }),
  updated: isoOrPocketBaseDate,
});

const statsSchema = z.object({
  cpu: z.number().finite(),
  cpub: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  la: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  m: nonnegative,
  mu: nonnegative,
  mp: z.number().finite().min(0).max(100),
  mb: nonnegative,
  s: nonnegative,
  su: nonnegative,
  d: nonnegative,
  du: nonnegative,
  dp: z.number().finite().min(0).max(100),
  dio: z.tuple([nonnegative, nonnegative]).optional(),
  dios: z.tuple([nonnegative, nonnegative, nonnegative, nonnegative, nonnegative, nonnegative]).optional(),
  b: z.tuple([nonnegative, nonnegative]).optional(),
  t: z.record(z.string(), z.number().finite()).optional(),
});

export const systemStatsListSchema = z.object({
  ...listEnvelope,
  items: z.array(z.object({
    created: isoOrPocketBaseDate,
    stats: statsSchema,
  })),
});

export const systemdServicesListSchema = z.object({
  ...listEnvelope,
  items: z.array(z.object({
    name: z.string().min(1).max(256),
    state: stateCode,
    sub: subStateCode,
    cpu: nonnegative,
    memory: nonnegative,
    updated: nonnegative,
  })),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;
export type HubInfo = z.infer<typeof hubInfoSchema>;
export type SystemRecord = z.infer<typeof systemRecordSchema>;
export type SystemStatsList = z.infer<typeof systemStatsListSchema>;
export type SystemdServicesList = z.infer<typeof systemdServicesListSchema>;
