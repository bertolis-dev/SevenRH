-- Seven RH — vérification anonyme "ce domaine d'email est-il déjà utilisé ?" pour l'écran
-- "Créer mon entreprise" (avertissement doux, non bloquant, voir le plan associé).
--
-- Contrainte de sécurité : la personne qui remplit ce formulaire n'a PAS encore de compte (clé
-- anon, aucune session) — impossible de passer par current_company_id()/RLS classique. La fonction
-- ne doit renvoyer QU'UN BOOLÉEN (« oui, au moins une entreprise a un salarié sur ce domaine »),
-- jamais le nom de l'entreprise, son id, ou toute autre donnée — une personne hors d'une entreprise
-- ne doit jamais pouvoir apprendre d'informations sur une autre entreprise via cet écran.
create or replace function email_domain_has_existing_company(p_email text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employees
    where lower(split_part(email, '@', 2)) = lower(split_part(p_email, '@', 2))
      and split_part(p_email, '@', 2) <> ''
  );
$$;

revoke all on function email_domain_has_existing_company(text) from public;
grant execute on function email_domain_has_existing_company(text) to anon, authenticated;
