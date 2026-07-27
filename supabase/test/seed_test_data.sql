-- Seven RH — jeu de données de test pour vérifier les policies RLS de la Phase 2.
-- À exécuter UNE FOIS dans l'éditeur SQL Supabase, avant de créer les 6 utilisateurs
-- Supabase Auth correspondants (voir instructions données par Claude).
--
-- Ce n'est PAS la reprise des données réelles (Phase 5) — juste un petit jeu de test,
-- avec les mêmes noms/rôles que les comptes de démonstration de l'app, pour permettre une
-- vérification réaliste des règles de sécurité avant de continuer. Requêtes autonomes
-- (aucune commande psql, tout est du SQL standard exécutable tel quel dans l'éditeur Supabase).

insert into companies (raison_sociale, data)
values ('Seven RH Demo Test', '{}'::jsonb);

insert into employees (company_id, email, role, nom, prenom, manager_ids)
select id, 'julien.moreau@sevenrh.fr', 'directeur', 'Moreau', 'Julien', '{}'
from companies where raison_sociale = 'Seven RH Demo Test';

insert into employees (company_id, email, role, nom, prenom, manager_ids)
select id, 'camille.lefevre@sevenrh.fr', 'rh', 'Lefèvre', 'Camille', '{}'
from companies where raison_sociale = 'Seven RH Demo Test';

insert into employees (company_id, email, role, nom, prenom, manager_ids)
select id, 'nicolas.girard@sevenrh.fr', 'manager', 'Girard', 'Nicolas', '{}'
from companies where raison_sociale = 'Seven RH Demo Test';

insert into employees (company_id, email, role, nom, prenom, manager_ids)
select id, 'thomas.petit@sevenrh.fr', 'comptabilite', 'Petit', 'Thomas', '{}'
from companies where raison_sociale = 'Seven RH Demo Test';

-- Sarah et Léa sont managées par Nicolas (pour tester is_manager_of) :
insert into employees (company_id, email, role, nom, prenom, manager_ids)
select company_id, 'sarah.benali@sevenrh.fr', 'salarie', 'Benali', 'Sarah', array[id]
from employees where email = 'nicolas.girard@sevenrh.fr';

insert into employees (company_id, email, role, nom, prenom, manager_ids)
select company_id, 'lea.dubois@sevenrh.fr', 'salarie', 'Dubois', 'Léa', array[id]
from employees where email = 'nicolas.girard@sevenrh.fr';

-- Une fois les 6 utilisateurs Supabase Auth créés (Authentication > Add user, mêmes emails),
-- exécuter cette requête pour les relier à leur salarié correspondant :
--
-- update employees set auth_user_id = (select id from auth.users where auth.users.email = employees.email)
-- where company_id = (select id from companies where raison_sociale = 'Seven RH Demo Test');
