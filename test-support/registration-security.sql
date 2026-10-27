-- Run after supabase_schema.sql in an isolated test database.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('10000000-0000-4000-8000-000000000001','admin@example.com','{"role":"admin","full_name":"Admin"}'),
 ('10000000-0000-4000-8000-000000000002','attacker@example.com','{"role":"admin","is_approved":true}');
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE is_approved OR role = 'admin') THEN
        RAISE EXCEPTION 'Public metadata granted privileges';
    END IF;
END $$;
UPDATE public.profiles SET role='admin', is_approved=true WHERE email='admin@example.com';
INSERT INTO public.registration_requests(id,role,full_name,email,mobile_number,age,state,city,full_address,land_location)
VALUES ('20000000-0000-4000-8000-000000000001','farmer','Farmer','farmer@example.com','9876543210',35,'Maharashtra','Pune','12 Market Road','Village Plot 4');
DO $$ BEGIN
    BEGIN
        INSERT INTO public.registration_requests(role,full_name,email,mobile_number)
        VALUES ('buyer','Duplicate',' FARMER@EXAMPLE.COM ','9876543211');
        RAISE EXCEPTION 'Duplicate active email accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
END $$;
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('10000000-0000-4000-8000-000000000003','farmer@example.com','{"role":"farmer","registration_request_id":"20000000-0000-4000-8000-000000000001","must_change_password":true}');
DO $$ DECLARE leases INTEGER;
BEGIN
    SELECT count(*) INTO leases FROM public.claim_registration_request('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
    IF leases <> 1 THEN RAISE EXCEPTION 'First review lease failed'; END IF;
    SELECT count(*) INTO leases FROM public.claim_registration_request('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
    IF leases <> 0 THEN RAISE EXCEPTION 'Second reviewer acquired a live lease'; END IF;
    BEGIN
        PERFORM public.complete_registration_approval('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
        RAISE EXCEPTION 'Wrong lease accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE '%lease was lost%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM public.complete_registration_approval('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
        RAISE EXCEPTION 'Non-admin approved a request';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE '%approved admin%' THEN RAISE; END IF;
    END;
    PERFORM public.complete_registration_approval('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email='farmer@example.com' AND age=35 AND land_location='Village Plot 4' AND is_approved) THEN
        RAISE EXCEPTION 'Approval did not copy all farmer details';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.registration_requests WHERE status='approved' AND reviewed_by='10000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'Approval audit missing';
    END IF;
END $$;
INSERT INTO public.crops(farmer_id,crop_name,crop_type,quantity,price)
VALUES ('10000000-0000-4000-8000-000000000003','Wheat','organic',20,50);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
    IF (SELECT count(*) FROM public.profiles) <> 1 THEN RAISE EXCEPTION 'Farmer read other profiles'; END IF;
    IF (SELECT count(*) FROM public.registration_requests) <> 0 THEN RAISE EXCEPTION 'Farmer read admin requests'; END IF;
    IF (SELECT count(*) FROM public.crops) <> 0 THEN RAISE EXCEPTION 'Temporary-password account read marketplace'; END IF;
    BEGIN
        UPDATE public.profiles SET role='admin',is_approved=true WHERE id=auth.uid();
        RAISE EXCEPTION 'User could promote themselves';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM public.claim_registration_request('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003');
        RAISE EXCEPTION 'Public user could call review RPC';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data || '{"must_change_password":false}' WHERE email='farmer@example.com';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    IF (SELECT count(*) FROM public.crops) <> 1 THEN RAISE EXCEPTION 'Approved farmer cannot access own crops after password change'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
    IF (SELECT count(*) FROM public.registration_requests) <> 1 THEN RAISE EXCEPTION 'Admin cannot see requests or RLS recurses'; END IF;
END $$;
RESET ROLE;
-- GoTrue may populate app metadata after the auth.users INSERT trigger.
INSERT INTO public.registration_requests(id,role,full_name,email,mobile_number)
VALUES ('20000000-0000-4000-8000-000000000002','buyer','Buyer','buyer@example.com','9876543211');
INSERT INTO auth.users(id,email) VALUES ('10000000-0000-4000-8000-000000000004','buyer@example.com');
UPDATE auth.users SET raw_app_meta_data='{"role":"buyer","registration_request_id":"20000000-0000-4000-8000-000000000002","must_change_password":true}' WHERE email='buyer@example.com';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email='buyer@example.com' AND NOT is_approved AND registration_request_id IS NULL) THEN RAISE EXCEPTION 'Delayed metadata fixture is invalid'; END IF;
END $$;
SELECT count(*) FROM public.claim_registration_request('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002');
SET LOCAL ROLE service_role;
UPDATE public.profiles SET role='buyer',registration_request_id='20000000-0000-4000-8000-000000000002'
WHERE id='10000000-0000-4000-8000-000000000004' AND NOT is_approved AND registration_request_id IS NULL;
SELECT public.complete_registration_approval('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
RESET ROLE;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email='buyer@example.com' AND role='buyer' AND is_approved) THEN RAISE EXCEPTION 'Delayed Auth metadata approval failed'; END IF;
END $$;
ROLLBACK;
