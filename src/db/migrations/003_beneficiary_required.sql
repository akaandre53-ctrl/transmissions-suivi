-- Rend obligatoire le rattachement de chaque transmission à une personne.
--
-- À appliquer APRÈS le déploiement du code qui renseigne beneficiary_id. Entre
-- la migration 002 et ce déploiement, l'ancien code a pu enregistrer des
-- transmissions sans personne : on les rattrape d'abord, sur le même principe
-- que la 002, puis on verrouille la colonne.

INSERT INTO beneficiaries (full_name)
SELECT DISTINCT ON (lower(btrim(person_name))) btrim(person_name)
  FROM transmissions
 WHERE beneficiary_id IS NULL
   AND length(btrim(person_name)) >= 2
 ORDER BY lower(btrim(person_name)), created_at
ON CONFLICT DO NOTHING;

UPDATE transmissions t
   SET beneficiary_id = b.id
  FROM beneficiaries b
 WHERE t.beneficiary_id IS NULL
   AND lower(btrim(t.person_name)) = lower(btrim(b.full_name));

INSERT INTO user_beneficiaries (user_id, beneficiary_id)
SELECT DISTINCT t.author_id, t.beneficiary_id
  FROM transmissions t
  JOIN users u ON u.id = t.author_id
 WHERE u.role = 'aidant'
   AND t.beneficiary_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Échoue explicitement s'il reste une ligne impossible à rattacher (nom vide),
-- plutôt que de laisser une transmission invisible pour toutes les familles.
ALTER TABLE transmissions ALTER COLUMN beneficiary_id SET NOT NULL;
