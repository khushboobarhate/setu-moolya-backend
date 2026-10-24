-- ==============================================================================
-- SETUMOOLYA (सेतुमूल्य) - SUPABASE DATABASE SCHEMA INITIALIZATION
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- 1. Enable UUID Extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Define Enum Types for User Roles and Verification
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM (
            'farmer',        -- Forager / Herbal Cultivator
            'fpo',           -- Farmer Producer Organisation / Village Collective
            'buyer',         -- Domestic & Global B2B Brands / Pharma / Nutraceutical
            'lab',           -- Certified Quality Testing Lab (AYUSH / NABL)
            'logistics',     -- Cold-chain & Export Logistics Partner
            'admin'          -- Platform Admin & Forest/NGO Agronomist
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyc_status') THEN
        CREATE TYPE kyc_status AS ENUM ('pending', 'verified', 'rejected');
    END IF;
END $$;

-- 3. Create Public Profiles Table linked to Supabase auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    phone TEXT,
    role user_role NOT NULL DEFAULT 'farmer',
    organization_name TEXT,                             -- FPO name, Company name, or Lab name
    location JSONB DEFAULT '{
        "state": "",
        "district": "",
        "village": "",
        "pin_code": "",
        "gps": {"lat": null, "lng": null}
    }'::jsonb,
    bio_specialization TEXT,                           -- e.g. "Kutki, Gucchi, Ashwagandha"
    bank_details JSONB DEFAULT '{
        "account_holder_name": "",
        "account_number": "",
        "ifsc_code": "",
        "upi_id": ""
    }'::jsonb,
    kyc_status kyc_status NOT NULL DEFAULT 'pending',
    is_verified BOOLEAN NOT NULL DEFAULT false,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexing for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_kyc ON public.profiles(kyc_status);

-- 4. Automatic 'updated_at' Timestamp Trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_profiles_updated_at ON public.profiles;
CREATE TRIGGER trigger_set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- 5. Automatic Profile Creation on Supabase Auth SignUp
-- Whenever a user is registered via Supabase Auth, this function copies their metadata into public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    assigned_role user_role := 'farmer';
    user_full_name TEXT;
    user_phone TEXT;
    user_org TEXT;
    user_spec TEXT;
BEGIN
    -- Safely parse role from user metadata
    IF NEW.raw_user_meta_data->>'role' IS NOT NULL THEN
        BEGIN
            assigned_role := (NEW.raw_user_meta_data->>'role')::user_role;
        EXCEPTION WHEN OTHERS THEN
            assigned_role := 'farmer';
        END;
    END IF;

    user_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
    user_phone := NEW.raw_user_meta_data->>'phone';
    user_org := NEW.raw_user_meta_data->>'organization_name';
    user_spec := NEW.raw_user_meta_data->>'bio_specialization';

    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        phone,
        role,
        organization_name,
        bio_specialization,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        NEW.email,
        user_full_name,
        user_phone,
        assigned_role,
        user_org,
        user_spec,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
        organization_name = COALESCE(EXCLUDED.organization_name, public.profiles.organization_name),
        updated_at = timezone('utc'::text, now());

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to execute after user insert in auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Row Level Security (RLS) Configuration
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy 1: Authenticated users can read all active profiles (e.g. buyers browsing FPOs, FPOs seeing labs)
CREATE POLICY "Profiles are readable by authenticated users"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- Policy 2: Users can update their own profile fields (except role and is_verified)
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy 3: Allow users to insert their own profile record if missing
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- 7. Verification function for Admin to approve KYC / Verify Users
CREATE OR REPLACE FUNCTION public.verify_user_kyc(target_user_id UUID, new_status kyc_status, verification_flag BOOLEAN)
RETURNS VOID AS $$
BEGIN
    UPDATE public.profiles
    SET 
        kyc_status = new_status,
        is_verified = verification_flag,
        updated_at = timezone('utc'::text, now())
    WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
