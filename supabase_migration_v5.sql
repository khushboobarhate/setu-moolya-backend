-- SetuMoolya v5: Farmer AI Agent & Buyer-Farmer Call Approval System
-- Safe, additive migration. Preserves all existing data.

BEGIN;

-- 1. AI Onboarding completion flag on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_onboarding_completed BOOLEAN NOT NULL DEFAULT false;

-- 2. Call Requests table for Buyer-Farmer call approvals
CREATE TABLE IF NOT EXISTS public.call_requests (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    buyer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    crop_id UUID REFERENCES public.crops(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
    buyer_note TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_call_requests_farmer_id ON public.call_requests(farmer_id);
CREATE INDEX IF NOT EXISTS idx_call_requests_buyer_id ON public.call_requests(buyer_id);
CREATE INDEX IF NOT EXISTS idx_call_requests_crop_id ON public.call_requests(crop_id);
CREATE INDEX IF NOT EXISTS idx_call_requests_status ON public.call_requests(status);
CREATE INDEX IF NOT EXISTS idx_call_requests_created_at ON public.call_requests(created_at DESC);

-- Attach handle_updated_at trigger
DROP TRIGGER IF EXISTS trg_call_requests_updated_at ON public.call_requests;
CREATE TRIGGER trg_call_requests_updated_at
    BEFORE UPDATE ON public.call_requests
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Enable Row Level Security (RLS)
ALTER TABLE public.call_requests ENABLE ROW LEVEL SECURITY;

-- Farmer can view call requests addressed to them
DROP POLICY IF EXISTS "Farmers can view own call requests" ON public.call_requests;
CREATE POLICY "Farmers can view own call requests"
    ON public.call_requests FOR SELECT
    TO authenticated
    USING (farmer_id = (SELECT auth.uid()));

-- Buyer can view call requests created by them
DROP POLICY IF EXISTS "Buyers can view own call requests" ON public.call_requests;
CREATE POLICY "Buyers can view own call requests"
    ON public.call_requests FOR SELECT
    TO authenticated
    USING (buyer_id = (SELECT auth.uid()));

-- Buyer can create call requests
DROP POLICY IF EXISTS "Buyers can insert call requests" ON public.call_requests;
CREATE POLICY "Buyers can insert call requests"
    ON public.call_requests FOR INSERT
    TO authenticated
    WITH CHECK (buyer_id = (SELECT auth.uid()));

-- Farmer can update call requests addressed to them (approve/reject)
DROP POLICY IF EXISTS "Farmers can update own call requests" ON public.call_requests;
CREATE POLICY "Farmers can update own call requests"
    ON public.call_requests FOR UPDATE
    TO authenticated
    USING (farmer_id = (SELECT auth.uid()))
    WITH CHECK (farmer_id = (SELECT auth.uid()));

COMMIT;
