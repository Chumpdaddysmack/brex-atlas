-- Private service-role-only storage. No anon/authenticated read policies.
CREATE TABLE IF NOT EXISTS public.tier_assessments (
  analysis_id uuid PRIMARY KEY REFERENCES public.analyses(id) ON DELETE CASCADE,
  record jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS public.report_shares (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  code_hash text,
  mode text NOT NULL CHECK (mode IN ('full','demo')),
  snapshot jsonb NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  revoked_at bigint,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS report_shares_analysis_idx ON public.report_shares(analysis_id);
ALTER TABLE public.tier_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tier_assessments, public.report_shares FROM anon, authenticated;
GRANT ALL ON public.tier_assessments, public.report_shares TO service_role;
