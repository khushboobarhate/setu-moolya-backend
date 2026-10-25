-- ==============================================================================
-- SETUMOOLYA (सेतुमूल्य) v3.0 – AGRICULTURAL E-COMMERCE & CALLING MIGRATION
-- Run this in your Supabase SQL Editor:
--   https://supabase.com/dashboard/project/_/sql
-- Safe to run multiple times (idempotent).
-- ==============================================================================

-- ==============================================================================
-- STEP 1: Add Call Availability to public.profiles
-- Allows Farmers and Buyers to toggle their call availability status ON or OFF.
-- ==============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_call_available BOOLEAN NOT NULL DEFAULT true;

-- Index for fast lookup on call availability
CREATE INDEX IF NOT EXISTS idx_profiles_call_avail ON public.profiles(is_call_available);

-- ==============================================================================
-- STEP 2: Create public.crops Table
-- Stores crop listings uploaded by Farmers with photos, quantity, crop type,
-- required price, and description.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.crops (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farmer_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    crop_name       TEXT NOT NULL,
    crop_type       TEXT NOT NULL CHECK (crop_type IN ('organic', 'inorganic', 'non-organic')),
    quantity        NUMERIC NOT NULL CHECK (quantity > 0),
    quantity_unit   TEXT NOT NULL DEFAULT 'kg',
    price           NUMERIC NOT NULL CHECK (price >= 0),
    description     TEXT,
    photos          TEXT[] NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold', 'archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexes for crops
CREATE INDEX IF NOT EXISTS idx_crops_farmer_id  ON public.crops(farmer_id);
CREATE INDEX IF NOT EXISTS idx_crops_crop_type  ON public.crops(crop_type);
CREATE INDEX IF NOT EXISTS idx_crops_status     ON public.crops(status);
CREATE INDEX IF NOT EXISTS idx_crops_created_at ON public.crops(created_at DESC);

-- ==============================================================================
-- STEP 3: Create public.crop_interests Table
-- Stores Buyer interest ratings and notes for crops.
-- Allows Farmers to identify interested buyers and their rating level.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.crop_interests (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    crop_id     UUID NOT NULL REFERENCES public.crops(id) ON DELETE CASCADE,
    buyer_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_crop_buyer_interest UNIQUE (crop_id, buyer_id)
);

-- Indexes for crop interests
CREATE INDEX IF NOT EXISTS idx_crop_interests_crop_id  ON public.crop_interests(crop_id);
CREATE INDEX IF NOT EXISTS idx_crop_interests_buyer_id ON public.crop_interests(buyer_id);
CREATE INDEX IF NOT EXISTS idx_crop_interests_rating   ON public.crop_interests(rating);

-- ==============================================================================
-- STEP 4: Create public.call_logs Table
-- Records call requests between Farmers and Buyers, tracking caller, receiver,
-- availability status, and whether call was permitted.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.call_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    caller_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receiver_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    crop_id         UUID REFERENCES public.crops(id) ON DELETE SET NULL,
    caller_role     user_role NOT NULL,
    receiver_role   user_role NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('permitted', 'blocked_receiver_unavailable', 'blocked_no_interest', 'failed')),
    phone_revealed  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexes for call logs
CREATE INDEX IF NOT EXISTS idx_call_logs_caller   ON public.call_logs(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_receiver ON public.call_logs(receiver_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_created  ON public.call_logs(created_at DESC);

-- ==============================================================================
-- STEP 5: Attach updated_at Triggers
-- ==============================================================================

DROP TRIGGER IF EXISTS trg_crops_updated_at ON public.crops;
CREATE TRIGGER trg_crops_updated_at
    BEFORE UPDATE ON public.crops
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_crop_interests_updated_at ON public.crop_interests;
CREATE TRIGGER trg_crop_interests_updated_at
    BEFORE UPDATE ON public.crop_interests
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- STEP 6: Row Level Security (RLS) Policies
-- ==============================================================================

-- ---- crops ----
ALTER TABLE public.crops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages crops" ON public.crops;
DROP POLICY IF EXISTS "Authenticated users view available crops" ON public.crops;
DROP POLICY IF EXISTS "Farmers manage their own crops" ON public.crops;

CREATE POLICY "Service role manages crops"
    ON public.crops FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users view available crops"
    ON public.crops FOR SELECT TO authenticated
    USING (status = 'available' OR farmer_id = auth.uid());

CREATE POLICY "Farmers manage their own crops"
    ON public.crops FOR ALL TO authenticated
    USING (farmer_id = auth.uid())
    WITH CHECK (farmer_id = auth.uid());

-- ---- crop_interests ----
ALTER TABLE public.crop_interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages crop_interests" ON public.crop_interests;
DROP POLICY IF EXISTS "Buyers manage their own interests" ON public.crop_interests;
DROP POLICY IF EXISTS "Farmers view interests on their crops" ON public.crop_interests;

CREATE POLICY "Service role manages crop_interests"
    ON public.crop_interests FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Buyers manage their own interests"
    ON public.crop_interests FOR ALL TO authenticated
    USING (buyer_id = auth.uid())
    WITH CHECK (buyer_id = auth.uid());

CREATE POLICY "Farmers view interests on their crops"
    ON public.crop_interests FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.crops
            WHERE crops.id = crop_interests.crop_id
              AND crops.farmer_id = auth.uid()
        )
    );

-- ---- call_logs ----
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages call_logs" ON public.call_logs;
DROP POLICY IF EXISTS "Users view their own call logs" ON public.call_logs;

CREATE POLICY "Service role manages call_logs"
    ON public.call_logs FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Users view their own call logs"
    ON public.call_logs FOR SELECT TO authenticated
    USING (caller_id = auth.uid() OR receiver_id = auth.uid());

-- ==============================================================================
-- DONE ✅
-- Migration v3.0 applied successfully.
-- ==============================================================================
