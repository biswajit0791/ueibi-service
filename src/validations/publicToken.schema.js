import { z } from 'zod';

// Shared by every public magic-link endpoint (hr, finance, ex-employer
// review) that resolves a :token route param via findActionToken/lookup —
// the token is only ever used as an opaque hash-lookup key, but validating
// its shape here still gives a clean 400 instead of falling through to a
// generic "not found" for obviously-malformed input.
export const tokenParamSchema = z.object({
  token: z.string().min(1).max(500),
});
