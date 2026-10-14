# Tester les migrations SQL sur un Postgres local (sans toucher à la production)

Rien de tout ceci ne tourne en ligne : une base jetable sur le PC remplace Supabase.

1. PostgreSQL 16 « binaries » (zip) décompressé hors du projet, par exemple `D:\pg-test\pgsql`.
2. `initdb -D data -U postgres -A trust`, puis `pg_ctl -D data -o "-p 54329" start`.
3. `create database sirh;` puis, dans l'ordre : `00_stubs.sql` (faux rôles et schémas `auth`/`storage` de Supabase),
   toutes les migrations de `supabase/migrations` (ordre alphabétique), puis `01_seed.sql` (1 entreprise, 6 comptes).
4. Un test se lance avec `psql -d sirh -f test_0073_echanges.sql` (fichier en UTF-8) ; les résultats attendus sont indiqués
   dans le script (`\echo`). Pour agir comme un utilisateur : `set local role authenticated;` puis
   `set local request.jwt.claim.sub='00000000-0000-0000-0000-00000000000N';` (N = 1 propriétaire, 2 RH, 3 manager,
   4 et 5 salariés du manager 3, 6 manager d'une autre équipe).

Limite : ce n'est pas Supabase (pas de PostgREST ni de stockage réel), seulement le moteur SQL et les politiques RLS.
