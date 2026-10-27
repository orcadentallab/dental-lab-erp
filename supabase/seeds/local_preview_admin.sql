-- Local Preview only. Never deploy this seed to a remote Supabase project.
-- Creates an idempotent staff login for the Docker-based local environment.
INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
)
VALUES (
    '71000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'local-preview-admin@orca.test',
    extensions.crypt('LocalPreview123!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
)
ON CONFLICT (id) DO UPDATE
SET encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    updated_at = now();

INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    created_at,
    updated_at
)
VALUES (
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    '{"sub":"71000000-0000-4000-8000-000000000001","email":"local-preview-admin@orca.test","email_verified":true}'::jsonb,
    'email',
    now(),
    now()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO public.users (
    id,
    auth_id,
    username,
    email,
    role,
    name,
    is_active
)
VALUES (
    '72000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'Sleem',
    'local-preview-admin@orca.test',
    'admin',
    'Local Preview Admin',
    true
)
ON CONFLICT (id) DO UPDATE
SET auth_id = EXCLUDED.auth_id,
    username = EXCLUDED.username,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    name = EXCLUDED.name,
    is_active = true;
