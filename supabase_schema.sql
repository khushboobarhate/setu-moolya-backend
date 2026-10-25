-- ==============================================================================
-- SETUMOOLYA (सेतुमूल्य) – SUPABASE DATABASE SCHEMA v2.0
-- Modules: Admin, Farmer, Buyer
-- Run this in your Supabase SQL Editor:
--   https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 2. ENUM TYPES
-- ==============================================================================

DO $$
BEGIN
    -- User roles (Admin, Farmer, Buyer only)
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'farmer', 'buyer');
    END IF;

    -- Registration request status
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registration_status') THEN
        CREATE TYPE registration_status AS ENUM ('pending', 'approved', 'rejected');
    END IF;
END $$;

-- ==============================================================================
-- 3. PROFILES TABLE  (Stores approved users only)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email                   TEXT NOT NULL UNIQUE,            -- Login email (system-generated on approval)
    full_name               TEXT NOT NULL,
    role                    user_role NOT NULL DEFAULT 'farmer',
    mobile_number           TEXT,                            -- Original registration phone
    nationality             TEXT,
    state                   TEXT,
    taluka                  TEXT,
    city                    TEXT,
    full_address            TEXT,
    land_location           TEXT,                            -- Farmer-only field
    preferred_language      TEXT DEFAULT 'en',
    photo_url               TEXT,                            -- Path to passport-size photo
    is_approved             BOOLEAN NOT NULL DEFAULT false,
    is_call_available       BOOLEAN NOT NULL DEFAULT true,
    registration_request_id UUID,                            -- FK to registration_requests
    created_at              TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_role       ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email      ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_approved   ON public.profiles(is_approved);

-- ==============================================================================
-- 4. REGISTRATION REQUESTS TABLE  (Pending / Rejected requests from Farmers & Buyers)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.registration_requests (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role                    user_role NOT NULL,
    full_name               TEXT NOT NULL,
    age                     INTEGER,
    mobile_number           TEXT NOT NULL,
    email                   TEXT,                            -- Optional: contact email provided during registration
    nationality             TEXT,
    state                   TEXT,
    taluka                  TEXT,
    city                    TEXT,
    full_address            TEXT,
    land_location           TEXT,                            -- Farmer-only
    preferred_language      TEXT DEFAULT 'en',
    photo_url               TEXT,                            -- Path to uploaded passport photo
    status                  registration_status NOT NULL DEFAULT 'pending',
    approved_login_email    TEXT,                            -- Email created on approval
    approved_user_id        UUID,                            -- auth.users UUID after approval
    created_at              TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reg_requests_status  ON public.registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_reg_requests_role    ON public.registration_requests(role);
CREATE INDEX IF NOT EXISTS idx_reg_requests_phone   ON public.registration_requests(mobile_number);

-- ==============================================================================
-- 5. OTP RECORDS TABLE  (Short-lived OTP for mobile verification)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.otp_records (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone       TEXT NOT NULL UNIQUE,          -- One active OTP per phone
    otp         TEXT NOT NULL,
    is_used     BOOLEAN NOT NULL DEFAULT false,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON public.otp_records(phone);

-- ==============================================================================
-- 6. AUTOMATIC updated_at TRIGGER
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to profiles
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Apply trigger to registration_requests
DROP TRIGGER IF EXISTS trg_reg_requests_updated_at ON public.registration_requests;
CREATE TRIGGER trg_reg_requests_updated_at
    BEFORE UPDATE ON public.registration_requests
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 7. AUTO-CREATE PROFILE ON SUPABASE AUTH SIGNUP
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    assigned_role user_role := 'farmer';
BEGIN
    -- Safely parse role from user metadata
    IF NEW.raw_user_meta_data->>'role' IS NOT NULL THEN
        BEGIN
            assigned_role := (NEW.raw_user_meta_data->>'role')::user_role;
        EXCEPTION WHEN OTHERS THEN
            assigned_role := 'farmer';
        END;
    END IF;

    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        role,
        mobile_number,
        preferred_language,
        photo_url,
        is_approved,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        assigned_role,
        COALESCE(NEW.raw_user_meta_data->>'phone', NULL),
        COALESCE(NEW.raw_user_meta_data->>'preferred_language', 'en'),
        NULL,
        (assigned_role = 'admin'),  -- Admin is auto-approved; Farmer/Buyer need approval
        timezone('utc', now()),
        timezone('utc', now())
    )
    ON CONFLICT (id) DO UPDATE SET
        email       = EXCLUDED.email,
        full_name   = EXCLUDED.full_name,
        updated_at  = timezone('utc', now());

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 8. ROW LEVEL SECURITY (RLS)
-- ==============================================================================

-- ---- Profiles ----
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Admins can read all profiles
CREATE POLICY "Admin can view all profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin'
        )
    );

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- Users can update their own profile (non-critical fields)
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Service role (backend) can insert profiles
CREATE POLICY "Service role can insert profiles"
    ON public.profiles FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Service role can update all profiles (for admin approval flow)
CREATE POLICY "Service role can update all profiles"
    ON public.profiles FOR UPDATE
    TO service_role
    USING (true);

-- ---- Registration Requests ----
ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;

-- Only service role (backend) can read/write registration requests
CREATE POLICY "Service role manages registration requests"
    ON public.registration_requests FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Admins can read registration requests
CREATE POLICY "Admins can read registration requests"
    ON public.registration_requests FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin'
        )
    );

-- ---- OTP Records ----
ALTER TABLE public.otp_records ENABLE ROW LEVEL SECURITY;

-- Only service role manages OTPs
CREATE POLICY "Service role manages OTPs"
    ON public.otp_records FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ==============================================================================
-- 9. CLEANUP FUNCTION – Purge expired/used OTPs (run periodically)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void AS $$
BEGIN
    DELETE FROM public.otp_records
    WHERE is_used = true OR expires_at < timezone('utc', now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 10. SEED ADMIN USER  (Run ONCE manually after first deployment)
-- ==============================================================================
-- NOTE: Create the admin user via Supabase Dashboard -> Authentication -> Users
-- Then run the following to set the role in the profiles table:
--
-- UPDATE public.profiles
-- SET role = 'admin', is_approved = true
-- WHERE email = 'admin@setumoolya.com';
-- ==============================================================================

-- ==============================================================================
-- 11. CROPS TABLE (Agricultural E-Commerce)
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

CREATE INDEX IF NOT EXISTS idx_crops_farmer_id  ON public.crops(farmer_id);
CREATE INDEX IF NOT EXISTS idx_crops_crop_type  ON public.crops(crop_type);
CREATE INDEX IF NOT EXISTS idx_crops_status     ON public.crops(status);

DROP TRIGGER IF EXISTS trg_crops_updated_at ON public.crops;
CREATE TRIGGER trg_crops_updated_at
    BEFORE UPDATE ON public.crops
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 12. CROP INTERESTS TABLE (Buyer Rating & Interest System)
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

CREATE INDEX IF NOT EXISTS idx_crop_interests_crop_id  ON public.crop_interests(crop_id);
CREATE INDEX IF NOT EXISTS idx_crop_interests_buyer_id ON public.crop_interests(buyer_id);

DROP TRIGGER IF EXISTS trg_crop_interests_updated_at ON public.crop_interests;
CREATE TRIGGER trg_crop_interests_updated_at
    BEFORE UPDATE ON public.crop_interests
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 13. CALL LOGS TABLE (Calling Functionality & Availability Tracking)
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

CREATE INDEX IF NOT EXISTS idx_call_logs_caller   ON public.call_logs(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_receiver ON public.call_logs(receiver_id);

-- RLS
ALTER TABLE public.crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages crops" ON public.crops FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users view available crops" ON public.crops FOR SELECT TO authenticated USING (status = 'available' OR farmer_id = auth.uid());
CREATE POLICY "Farmers manage their own crops" ON public.crops FOR ALL TO authenticated USING (farmer_id = auth.uid()) WITH CHECK (farmer_id = auth.uid());

CREATE POLICY "Service role manages crop_interests" ON public.crop_interests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Buyers manage their own interests" ON public.crop_interests FOR ALL TO authenticated USING (buyer_id = auth.uid()) WITH CHECK (buyer_id = auth.uid());
CREATE POLICY "Farmers view interests on their crops" ON public.crop_interests FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.crops WHERE crops.id = crop_interests.crop_id AND crops.farmer_id = auth.uid()));

CREATE POLICY "Service role manages call_logs" ON public.call_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users view their own call logs" ON public.call_logs FOR SELECT TO authenticated
    USING (caller_id = auth.uid() OR receiver_id = auth.uid());
