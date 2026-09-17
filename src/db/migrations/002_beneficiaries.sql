-- Personnes accompagnées et droits d'accès par personne.
--
-- Jusqu'ici, un compte famille voyait toutes les transmissions de l'application :
-- rien ne reliait un compte à la personne qu'il suit. Cette migration introduit
-- la fiche « personne accompagnée » et la table qui dit quel compte suit qui.
--
-- Elle est volontairement additive : la colonne transmissions.beneficiary_id
-- reste facultative. L'ancienne version du code, encore en ligne pendant le
-- déploiement, continue d'enregistrer sans la renseigner. La migration 003,
-- appliquée une fois le nouveau code en ligne, rattrape ces lignes puis rend la
-- colonne obligatoire.

CREATE TABLE IF NOT EXISTS beneficiaries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL CHECK (length(btrim(full_name)) >= 2),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS beneficiaries_name_lower_idx
  ON beneficiaries (lower(btrim(full_name)));

CREATE TABLE IF NOT EXISTS user_beneficiaries (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL REFERENCES beneficiaries(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, beneficiary_id)
);

CREATE INDEX IF NOT EXISTS user_beneficiaries_beneficiary_idx
  ON user_beneficiaries (beneficiary_id);

ALTER TABLE transmissions
  ADD COLUMN IF NOT EXISTS beneficiary_id uuid REFERENCES beneficiaries(id);

CREATE INDEX IF NOT EXISTS transmissions_beneficiary_idx
  ON transmissions (beneficiary_id, created_at DESC);

-- Reprise de l'existant : une fiche par nom déjà saisi, en gardant
-- l'orthographe de la première saisie.
INSERT INTO beneficiaries (full_name)
SELECT DISTINCT ON (lower(btrim(person_name))) btrim(person_name)
  FROM transmissions
 WHERE length(btrim(person_name)) >= 2
 ORDER BY lower(btrim(person_name)), created_at
ON CONFLICT DO NOTHING;

UPDATE transmissions t
   SET beneficiary_id = b.id
  FROM beneficiaries b
 WHERE t.beneficiary_id IS NULL
   AND lower(btrim(t.person_name)) = lower(btrim(b.full_name));

-- Une aidante garde l'accès aux personnes pour lesquelles elle a déjà saisi.
-- Les comptes famille, eux, ne reçoivent AUCUN accès automatique : rien dans
-- les données ne dit quelle famille suit quelle personne. C'est à l'admin de
-- les rattacher. Un accès oublié se corrige en un clic ; un accès accordé à
-- tort expose des données de santé.
INSERT INTO user_beneficiaries (user_id, beneficiary_id)
SELECT DISTINCT t.author_id, t.beneficiary_id
  FROM transmissions t
  JOIN users u ON u.id = t.author_id
 WHERE u.role = 'aidant'
   AND t.beneficiary_id IS NOT NULL
ON CONFLICT DO NOTHING;
