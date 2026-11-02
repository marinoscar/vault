-- =============================================================================
-- Invented data for the baseline rehearsal (scripts/baseline-rehearsal.sh).
-- Loaded into a database that has ONLY Vault's original seven migrations, i.e.
-- the shape of production before the platform history is adopted. It exercises
-- every row type the platform migrations move or backfill:
--   - three users holding admin / contributor / viewer through user_roles
--     (platform migration 0024 deletes the org-role rows and moves them onto
--     memberships);
--   - storage objects with and without a media folder (the app migration
--     20261102130000_add_media_folder_files moves media_folder_id into
--     media_folder_files), one of them attached to a secret version;
--   - a current secret version (partial unique index secret_versions_current_unique).
-- Every address is @example.test; the "ciphertext" is not real.
-- =============================================================================
BEGIN;

INSERT INTO roles (id, name, description) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'admin', 'Full system access'),
  ('00000000-0000-4000-8000-0000000000a2', 'contributor', 'Standard user'),
  ('00000000-0000-4000-8000-0000000000a3', 'viewer', 'Read-only access');

INSERT INTO permissions (id, name, description) VALUES
  ('00000000-0000-4000-8000-0000000000b1', 'secrets:read', 'Read own secrets'),
  ('00000000-0000-4000-8000-0000000000b2', 'secrets:write', 'Write own secrets'),
  ('00000000-0000-4000-8000-0000000000b3', 'storage:read', 'Read storage objects'),
  ('00000000-0000-4000-8000-0000000000b4', 'storage:write', 'Write storage objects'),
  ('00000000-0000-4000-8000-0000000000b5', 'user_settings:read', 'Read own settings'),
  ('00000000-0000-4000-8000-0000000000b6', 'user_settings:write', 'Write own settings'),
  ('00000000-0000-4000-8000-0000000000b7', 'media:read', 'Read own media'),
  ('00000000-0000-4000-8000-0000000000b8', 'users:read', 'View users');

INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-8000-0000000000a1', id FROM permissions;
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-8000-0000000000a2', id FROM permissions WHERE name <> 'users:read';
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-8000-0000000000a3', id FROM permissions
WHERE name IN ('secrets:read', 'storage:read', 'user_settings:read', 'media:read');

INSERT INTO users (id, email, display_name, updated_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin@example.test', 'Admin A', now()),
  ('00000000-0000-4000-8000-000000000002', 'contributor@example.test', 'Contributor B', now()),
  ('00000000-0000-4000-8000-000000000003', 'viewer@example.test', 'Viewer C', now());

INSERT INTO user_roles (user_id, role_id) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a3');

INSERT INTO user_settings (id, user_id, value, updated_at) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000002', '{"theme":"dark"}', now());
INSERT INTO system_settings (id, key, value, updated_at) VALUES
  ('00000000-0000-4000-8000-0000000000c2', 'global', '{"ui":{"allowUserThemeOverride":true},"features":{}}', now());
INSERT INTO allowed_emails (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000c3', 'contributor@example.test');

INSERT INTO media_folders (id, name, user_id, updated_at) VALUES
  ('00000000-0000-4000-8000-0000000000d1', 'Folder One', '00000000-0000-4000-8000-000000000002', now()),
  ('00000000-0000-4000-8000-0000000000d2', 'Folder Two', '00000000-0000-4000-8000-000000000002', now());

INSERT INTO storage_objects (id, name, size, mime_type, storage_key, status, uploaded_by_id, media_folder_id, updated_at) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'photo-1.png', 1024, 'image/png', 'uploads/fixture/1.png', 'ready', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000d1', now()),
  ('00000000-0000-4000-8000-0000000000e2', 'photo-2.png', 2048, 'image/png', 'uploads/fixture/2.png', 'ready', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000d2', now()),
  ('00000000-0000-4000-8000-0000000000e3', 'card-front.png', 4096, 'image/png', 'uploads/fixture/3.png', 'ready', '00000000-0000-4000-8000-000000000002', NULL, now()),
  ('00000000-0000-4000-8000-0000000000e4', 'unfiled.pdf', 512, 'application/pdf', 'uploads/fixture/4.pdf', 'ready', '00000000-0000-4000-8000-000000000003', NULL, now());
INSERT INTO storage_object_chunks (id, object_id, part_number, e_tag, size) VALUES
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000e1', 1, 'etag-fixture', 1024);

INSERT INTO secret_types (id, name, fields, is_system, allow_attachments, updated_at) VALUES
  ('00000000-0000-4000-8000-0000000000f1', 'Login', '[]', true, true, now());
INSERT INTO secrets (id, name, type_id, created_by_id, updated_at) VALUES
  ('00000000-0000-4000-8000-0000000000f2', 'Fixture secret', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000002', now());
INSERT INTO secret_versions (id, secret_id, version, encrypted_data, iv, auth_tag, created_by_id, is_current) VALUES
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f2', 1, 'ZmFrZS1jaXBoZXJ0ZXh0', 'ZmFrZS1pdg==', 'ZmFrZS10YWc=', '00000000-0000-4000-8000-000000000002', false),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f2', 2, 'ZmFrZS1jaXBoZXJ0ZXh0Mg==', 'ZmFrZS1pdg==', 'ZmFrZS10YWc=', '00000000-0000-4000-8000-000000000002', true);
INSERT INTO secret_attachments (id, secret_id, storage_object_id, secret_version_id, role) VALUES
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000f4', 'card_front');

INSERT INTO backup_schedules (id, enabled, updated_at) VALUES ('default', false, now());
INSERT INTO backup_runs (id, status, trigger, scope) VALUES
  ('00000000-0000-4000-8000-0000000000f6', 'succeeded', 'manual', 'system');
INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id) VALUES
  ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-000000000001', 'user:update', 'user', '00000000-0000-4000-8000-000000000002');

COMMIT;
