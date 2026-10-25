-- ==============================================================================
-- SETUMOOLYA v2.0 – MIGRATION SCRIPT
-- Run this in your Supabase SQL Editor if you ALREADY ran the old schema.
-- This safely adds all new columns, updates ENUMs, and recreates triggers.
-- Safe to run multiple times (idempotent).
-- ==============================================================================

-- ==============================================================================
-- STEP 1: Migrate user_role ENUM
-- Add 'farmer', 'buyer', 'admin' if the old enum had extra roles.
-- Drop old values not in new set (fpo, lab, logistics) safely.
-- ==============================================================================

DO $$
BEGIN
    -- Add 'farmer' if missing (unlikely but safe)
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'farmer'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')) THEN
        ALTER TYPE user_role ADD VALUE 'farmer';
    END IF;

    -- Add 'buyer' if missing
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'buyer'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')) THEN
        ALTER TYPE user_role ADD VALUE 'buyer';
    END IF;

    -- Add 'admin' if missing
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'admin'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')) THEN
        ALTER TYPE user_role ADD VALUE 'admin';
    END IF;
END $$;

-- Create registration_status enum if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registration_status') THEN
        CREATE TYPE registration_status AS ENUM ('pending', 'approved', 'rejected');
    END IF;
END $$;

-- ==============================================================================
-- STEP 2: Migrate public.profiles – add missing columns
-- ==============================================================================

-- is_approved (core new column – was is_verified before)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false;

-- Backfill: if old is_verified column exists, copy its value into is_approved
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'profiles'
          AND column_name  = 'is_verified'
    ) THEN
        UPDATE public.profiles SET is_approved = is_verified WHERE is_approved = false;
    END IF;
END $$;

-- registration_request_id (FK placeholder – not enforced for migration simplicity)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS registration_request_id UUID;

-- mobile_number (was 'phone' in old schema)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS mobile_number TEXT;

-- Backfill: copy old 'phone' into mobile_number if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'profiles'
          AND column_name  = 'phone'
    ) THEN
        UPDATE public.profiles SET mobile_number = phone WHERE mobile_number IS NULL;
    END IF;
END $$;

-- Address-related fields
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nationality      TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS state            TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS taluka           TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city             TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_address     TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS land_location    TEXT;

-- Language and photo
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'en';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS photo_url           TEXT;

-- Backfill preferred_language with 'en' if null
UPDATE public.profiles SET preferred_language = 'en' WHERE preferred_language IS NULL;

-- Backfill photo_url from avatar_url if that column exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'profiles'
          AND column_name  = 'avatar_url'
    ) THEN
        UPDATE public.profiles SET photo_url = avatar_url WHERE photo_url IS NULL;
    END IF;
END $$;

-- ==============================================================================
-- STEP 3: Ensure indexes exist
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role       ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email      ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_approved   ON public.profiles(is_approved);

-- ==============================================================================
-- STEP 4: Create registration_requests table (new table)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.registration_requests (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role                    user_role NOT NULL,
    full_name               TEXT NOT NULL,
    age                     INTEGER,
    mobile_number           TEXT NOT NULL,
    email                   TEXT,
    nationality             TEXT,
    state                   TEXT,
    taluka                  TEXT,
    city                    TEXT,
    full_address            TEXT,
    land_location           TEXT,
    preferred_language      TEXT DEFAULT 'en',
    photo_url               TEXT,
    status                  registration_status NOT NULL DEFAULT 'pending',
    approved_login_email    TEXT,
    approved_user_id        UUID,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_reg_requests_status ON public.registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_reg_requests_role   ON public.registration_requests(role);
CREATE INDEX IF NOT EXISTS idx_reg_requests_phone  ON public.registration_requests(mobile_number);

-- ==============================================================================
-- STEP 5: Create otp_records table (new table)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.otp_records (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone       TEXT NOT NULL UNIQUE,
    otp         TEXT NOT NULL,
    is_used     BOOLEAN NOT NULL DEFAULT false,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON public.otp_records(phone);

-- ==============================================================================
-- STEP 6: Recreate updated_at trigger function
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_reg_requests_updated_at ON public.registration_requests;
CREATE TRIGGER trg_reg_requests_updated_at
    BEFORE UPDATE ON public.registration_requests
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- STEP 7: Recreate handle_new_user trigger (FIXED – uses only existing columns)
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
        email              = EXCLUDED.email,
        full_name          = EXCLUDED.full_name,
        mobile_number      = COALESCE(EXCLUDED.mobile_number, public.profiles.mobile_number),
        preferred_language = COALESCE(EXCLUDED.preferred_language, public.profiles.preferred_language),
        updated_at         = timezone('utc', now());

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- STEP 8: RLS Policies
-- ==============================================================================

-- ---- profiles ----
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can view all profiles"        ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile"         ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"       ON public.profiles;
DROP POLICY IF EXISTS "Service role can insert profiles"   ON public.profiles;
DROP POLICY IF EXISTS "Service role can update all profiles" ON public.profiles;
-- Drop any old policies from previous schema
DROP POLICY IF EXISTS "Profiles are readable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile"           ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile"           ON public.profiles;

CREATE POLICY "Admin can view all profiles"
    ON public.profiles FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin'
        )
    );

CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT TO authenticated
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Service role can insert profiles"
    ON public.profiles FOR INSERT TO service_role
    WITH CHECK (true);

CREATE POLICY "Service role can update all profiles"
    ON public.profiles FOR UPDATE TO service_role
    USING (true);

-- ---- registration_requests ----
ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages registration requests" ON public.registration_requests;
DROP POLICY IF EXISTS "Admins can read registration requests"      ON public.registration_requests;

CREATE POLICY "Service role manages registration requests"
    ON public.registration_requests FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read registration requests"
    ON public.registration_requests FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin'
        )
    );

-- ---- otp_records ----
ALTER TABLE public.otp_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages OTPs" ON public.otp_records;

CREATE POLICY "Service role manages OTPs"
    ON public.otp_records FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ==============================================================================
-- STEP 9: Cleanup function for expired OTPs
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void AS $$
BEGIN
    DELETE FROM public.otp_records
    WHERE is_used = true OR expires_at < timezone('utc', now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- DONE ✅
-- After running this migration:
-- 1. Make sure your admin user row has: role='admin', is_approved=true
--    UPDATE public.profiles SET role='admin', is_approved=true WHERE email='your-admin@email.com';
-- ==============================================================================
