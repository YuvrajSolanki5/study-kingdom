-- Development seed data, applied by `supabase db reset` on the LOCAL stack only.
-- Never run against a hosted project.

-- Local-only password for the API role (production uses a generated secret).
alter role game_api with password 'dev-only-password';

-- Two demo username accounts (password: study-kingdom-dev). Their villages are
-- created on first sign-in, exactly like real players.
do $$
declare
  demo record;
begin
  for demo in
    select * from (values
      ('11111111-1111-4111-8111-111111111111'::uuid, 'demo1@accounts.studykingdom.invalid', 'Demo Scholar'),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'demo2@accounts.studykingdom.invalid', 'Rival Scholar')
    ) as t(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', demo.id, 'authenticated', 'authenticated', demo.email,
      extensions.crypt('study-kingdom-dev', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', demo.name),
      now(), now(), '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), demo.id, jsonb_build_object('sub', demo.id::text, 'email', demo.email, 'email_verified', true),
      'email', demo.id::text, now(), now(), now())
    on conflict do nothing;
  end loop;
end
$$;
