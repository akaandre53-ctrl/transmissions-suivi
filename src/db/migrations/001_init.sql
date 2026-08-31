-- Schéma initial : utilisateurs, sessions, transmissions, photos, limitation de débit.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- utilisateurs
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'aidant', 'famille')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- L'e-mail est comparé en minuscules : l'index garantit l'unicité réelle.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

-- -------------------------------------------------------------------- sessions
-- On ne stocke que le SHA-256 du jeton : une fuite de la base ne permet pas
-- de rejouer une session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- --------------------------------------------------------------- transmissions
CREATE TABLE IF NOT EXISTS transmissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Référence générée par le navigateur pour un brouillon donné. Elle rend la
  -- soumission idempotente : un renvoi après échec réseau ne crée pas de doublon.
  client_ref  text NOT NULL,
  author_id   uuid NOT NULL REFERENCES users(id),
  entry_date  date NOT NULL,
  person_name text NOT NULL,
  data        jsonb NOT NULL,
  summary     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- État de la recopie vers Google Sheets. La transmission est valide en base
  -- même si la feuille est injoignable.
  sheet_status   text NOT NULL DEFAULT 'pending'
                 CHECK (sheet_status IN ('pending', 'synced', 'failed', 'skipped')),
  sheet_synced_at timestamptz,
  sheet_attempts  integer NOT NULL DEFAULT 0,
  sheet_error     text
);

CREATE UNIQUE INDEX IF NOT EXISTS transmissions_client_ref_idx ON transmissions (client_ref);
CREATE INDEX IF NOT EXISTS transmissions_entry_date_idx ON transmissions (entry_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS transmissions_author_idx ON transmissions (author_id);
-- Index partiel : la file de reprise ne balaie que les lignes en attente.
CREATE INDEX IF NOT EXISTS transmissions_sheet_pending_idx
  ON transmissions (created_at) WHERE sheet_status IN ('pending', 'failed');

-- ---------------------------------------------------------------------- photos
-- Les photos sont téléversées une par une, avant la soumission du formulaire.
-- transmission_id reste NULL tant que le formulaire n'est pas validé.
CREATE TABLE IF NOT EXISTS images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transmission_id uuid REFERENCES transmissions(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_ref      text,
  field_name      text NOT NULL,
  category        text NOT NULL,
  filename        text NOT NULL,
  mime_type       text NOT NULL,
  byte_size       integer NOT NULL,
  content         bytea NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS images_transmission_idx ON images (transmission_id);
CREATE INDEX IF NOT EXISTS images_client_ref_idx ON images (client_ref);
-- Index partiel pour le nettoyage des photos jamais rattachées à une transmission.
CREATE INDEX IF NOT EXISTS images_orphans_idx
  ON images (created_at) WHERE transmission_id IS NULL;

-- ----------------------------------------------------- limitation de débit
-- Remplace le compteur en mémoire, inopérant en environnement serverless
-- où chaque requête peut atterrir sur une instance différente.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);
