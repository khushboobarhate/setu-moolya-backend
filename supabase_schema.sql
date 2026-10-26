-- SetuMoolya v4 fresh-install schema: Admin, Farmer, Buyer.
-- Existing installations should use supabase_migration_v4.sql instead.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE public.user_role AS ENUM ('admin', 'farmer', 'buyer');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registration_status') THEN
        CREATE TYPE public.registration_status AS ENUM ('pending', 'approved', 'rejected');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role public.user_role NOT NULL DEFAULT 'farmer',
    age INTEGER,
    mobile_number TEXT,
    nationality TEXT,
    state TEXT,
    taluka TEXT,
    city TEXT,
    full_address TEXT,
    land_location TEXT,
    preferred_language TEXT DEFAULT 'en',
    photo_url TEXT,
    is_approved BOOLEAN NOT NULL DEFAULT false,
    is_call_available BOOLEAN NOT NULL DEFAULT true,
    registration_request_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

CREATE TABLE IF NOT EXISTS public.registration_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role public.user_role NOT NULL,
    full_name TEXT NOT NULL,
    age INTEGER,
    mobile_number TEXT NOT NULL,
    email TEXT, -- Legacy requests may lack email; the API requires it for new ones.
    nationality TEXT,
    state TEXT,
    taluka TEXT,
    city TEXT,
    full_address TEXT,
    land_location TEXT,
    preferred_language TEXT DEFAULT 'en',
    photo_url TEXT,
    status public.registration_status NOT NULL DEFAULT 'pending',
    approved_login_email TEXT,
    approved_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reg_requests_status ON public.registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_reg_requests_role ON public.registration_requests(role);

CREATE TABLE IF NOT EXISTS public.crops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farmer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    crop_name TEXT NOT NULL,
    crop_type TEXT NOT NULL CHECK (crop_type IN ('organic', 'inorganic', 'non-organic')),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    quantity_unit TEXT NOT NULL DEFAULT 'kg',
    price NUMERIC NOT NULL CHECK (price >= 0),
    description TEXT,
    photos TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crops_farmer_id ON public.crops(farmer_id);
CREATE INDEX IF NOT EXISTS idx_crops_status ON public.crops(status);

CREATE TABLE IF NOT EXISTS public.crop_interests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    crop_id UUID NOT NULL REFERENCES public.crops(id) ON DELETE CASCADE,
    buyer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_crop_buyer_interest UNIQUE (crop_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS idx_crop_interests_buyer_id ON public.crop_interests(buyer_id);

CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    caller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    crop_id UUID REFERENCES public.crops(id) ON DELETE SET NULL,
    caller_role public.user_role NOT NULL,
    receiver_role public.user_role NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('permitted', 'blocked_receiver_unavailable', 'blocked_no_interest', 'failed')),
    phone_revealed TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_logs_caller ON public.call_logs(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_receiver ON public.call_logs(receiver_id);

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DO $$ DECLARE table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['profiles', 'registration_requests', 'crops', 'crop_interests'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON public.%I', table_name);
        EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', table_name);
    END LOOP;
END $$;

-- SetuMoolya v4: manual admin review and email credentials.
-- Existing installations: apply v2/v3 if needed, then run this entire file.
-- This migration does not delete historical requests, OTP records, or accounts.
-- Account setup after COMMIT (on the backend host; no plaintext passwords in SQL):
--   1. Set ADMIN_EMAIL=admin-user@gmail.com and ADMIN_PASSWORD in the ignored .env.
--   2. Run npm run admin:create (creates/approves admin and verifies its login).
--   3. Run npm run demo:create (registers/approves demo farmer and buyer; no emails).
-- Never write directly to auth.users to seed passwords; use the Auth admin API.
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE public.registration_requests
    ADD COLUMN IF NOT EXISTS review_token UUID,
    ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS credentials_email_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (credentials_email_status IN ('pending', 'sent', 'failed')),
    ADD COLUMN IF NOT EXISTS credentials_email_sent_at TIMESTAMPTZ;

UPDATE public.registration_requests SET email = lower(btrim(email)) WHERE email IS NOT NULL;
-- If historical duplicates exist, the transaction intentionally fails here.
-- Review them manually (see README); do not silently discard applications.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_registration_email
    ON public.registration_requests (lower(btrim(email)))
    WHERE status IN ('pending', 'approved') AND email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_registration_request
    ON public.profiles (registration_request_id) WHERE registration_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_normalized_email ON public.profiles (lower(btrim(email)));

-- App metadata is managed by the service role. Public signup metadata must never
-- be allowed to create an admin or approve an account.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    assigned_role public.user_role := 'farmer';
    request_id UUID;
BEGIN
    IF NEW.raw_app_meta_data->>'role' IN ('farmer', 'buyer', 'admin') THEN
        assigned_role := (NEW.raw_app_meta_data->>'role')::public.user_role;
    END IF;
    request_id := NULLIF(NEW.raw_app_meta_data->>'registration_request_id', '')::UUID;
    INSERT INTO public.profiles (id, email, full_name, role, mobile_number, registration_request_id, is_approved)
    VALUES (NEW.id, NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        assigned_role, NEW.raw_user_meta_data->>'phone', request_id, false);
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.claim_registration_request(p_request_id UUID, p_review_token UUID)
RETURNS SETOF public.registration_requests LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    UPDATE public.registration_requests
    SET review_token = p_review_token, review_started_at = now()
    WHERE id = p_request_id AND p_review_token IS NOT NULL
      AND (review_token IS NULL OR review_started_at < now() - interval '10 minutes')
    RETURNING *;
$$;

CREATE OR REPLACE FUNCTION public.complete_registration_approval(
    p_request_id UUID, p_user_id UUID, p_review_token UUID, p_admin_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    application public.registration_requests;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_id AND role = 'admin' AND is_approved) THEN
        RAISE EXCEPTION 'An approved admin must review this request';
    END IF;
    SELECT * INTO application FROM public.registration_requests
      WHERE id = p_request_id AND review_token = p_review_token AND status = 'pending' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Request is no longer pending or review lease was lost'; END IF;
    IF application.role NOT IN ('farmer', 'buyer') OR application.email IS NULL OR btrim(application.email) = '' THEN
        RAISE EXCEPTION 'A valid applicant role and contact email are required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id AND lower(email) = application.email
        AND raw_app_meta_data->>'registration_request_id' = p_request_id::TEXT
        AND raw_app_meta_data->>'role' = application.role::TEXT) THEN
        RAISE EXCEPTION 'Account does not belong to this registration request';
    END IF;
    UPDATE public.profiles SET
        email = application.email, full_name = application.full_name, age = application.age,
        role = application.role, mobile_number = application.mobile_number,
        nationality = application.nationality, state = application.state, taluka = application.taluka,
        city = application.city, full_address = application.full_address, land_location = application.land_location,
        preferred_language = application.preferred_language, photo_url = application.photo_url,
        is_approved = true, registration_request_id = application.id
      WHERE id = p_user_id AND registration_request_id = p_request_id AND NOT is_approved;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unapproved linked profile not found'; END IF;
    UPDATE public.registration_requests SET status = 'approved', approved_user_id = p_user_id,
        approved_login_email = application.email, reviewed_by = p_admin_id, reviewed_at = now(),
        credentials_email_status = 'pending', credentials_email_sent_at = NULL
      WHERE id = p_request_id;
    RETURN p_user_id;
END;
$$;

-- Definer helpers avoid the original profiles policy recursively querying itself.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_approved);
$$;
CREATE OR REPLACE FUNCTION public.is_approved_member(expected_role TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.id
        WHERE p.id = auth.uid() AND p.role::TEXT = expected_role AND p.is_approved
          AND COALESCE(u.raw_app_meta_data->>'must_change_password', 'false') = 'false');
$$;

-- All writes go through the backend service role and its approval/password guards.
-- In particular, users cannot update their own role/is_approved directly via REST.
DO $$
DECLARE item RECORD;
BEGIN
    FOR item IN SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('profiles', 'registration_requests', 'crops', 'crop_interests', 'call_logs')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', item.policyname, item.tablename);
    END LOOP;
END $$;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profiles, public.registration_requests, public.crops, public.crop_interests, public.call_logs FROM anon, authenticated;
GRANT SELECT ON public.profiles, public.registration_requests, public.crops, public.crop_interests, public.call_logs TO authenticated;
GRANT ALL ON public.profiles, public.registration_requests, public.crops, public.crop_interests, public.call_logs TO service_role;

CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated
    USING (id = auth.uid() OR public.is_platform_admin());
CREATE POLICY requests_admin_read ON public.registration_requests FOR SELECT TO authenticated
    USING (public.is_platform_admin());
CREATE POLICY crops_read ON public.crops FOR SELECT TO authenticated
    USING (public.is_platform_admin() OR (public.is_approved_member('farmer') AND farmer_id = auth.uid())
        OR (public.is_approved_member('buyer') AND status = 'available'));
CREATE POLICY interests_read ON public.crop_interests FOR SELECT TO authenticated
    USING (public.is_platform_admin() OR (public.is_approved_member('buyer') AND buyer_id = auth.uid())
        OR (public.is_approved_member('farmer') AND EXISTS (SELECT 1 FROM public.crops c WHERE c.id = crop_id AND c.farmer_id = auth.uid())));
CREATE POLICY calls_read ON public.call_logs FOR SELECT TO authenticated
    USING (public.is_platform_admin() OR ((public.is_approved_member('farmer') OR public.is_approved_member('buyer'))
        AND (caller_id = auth.uid() OR receiver_id = auth.uid())));

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_registration_request(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_registration_approval(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_registration_request(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_registration_approval(UUID, UUID, UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.is_platform_admin(), public.is_approved_member(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(), public.is_approved_member(TEXT) TO authenticated, service_role;

COMMIT;
