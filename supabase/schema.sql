-- Périmo : à coller dans Supabase > SQL Editor, puis « Run ».
-- Le script peut être relancé sans risque.

-- --- Produits du frigo ---

create table if not exists public.produits (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  nom text not null check (length(nom) > 0),
  marque text,
  code_barre text,
  image_url text,
  quantite int not null default 1 check (quantite >= 1),
  date_peremption date not null,
  ajoute_le date not null default current_date
);

create index if not exists produits_user_date on public.produits (user_id, date_peremption);

-- Chaque personne connectée ne voit et ne modifie que ses propres produits
alter table public.produits enable row level security;
drop policy if exists "Chacun gère ses produits" on public.produits;
create policy "Chacun gère ses produits" on public.produits
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --- Réglages (sujet ntfy) ---

create table if not exists public.reglages (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  ntfy_topic text not null,
  jours_alerte int not null default 5 check (jours_alerte between 1 and 30)
);

alter table public.reglages enable row level security;
drop policy if exists "Chacun gère ses réglages" on public.reglages;
create policy "Chacun gère ses réglages" on public.reglages
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --- Alerte quotidienne ---

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Envoie à chaque personne la liste de ses produits qui périment bientôt
create or replace function public.envoyer_alertes_perimo()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  aujourdhui date := (now() at time zone 'Europe/Paris')::date;
begin
  for r in
    select
      g.ntfy_topic,
      count(*) as n,
      bool_or(p.date_peremption - aujourdhui <= 1) as urgent,
      string_agg(
        '• ' || p.nom || ' : ' || case
          when p.date_peremption < aujourdhui
            then 'périmé depuis ' || (aujourdhui - p.date_peremption) || ' j'
          when p.date_peremption = aujourdhui then 'périme aujourd''hui'
          when p.date_peremption = aujourdhui + 1 then 'périme demain'
          else 'dans ' || (p.date_peremption - aujourdhui) || ' jours'
        end,
        E'\n' order by p.date_peremption
      ) as message
    from public.reglages g
    join public.produits p on p.user_id = g.user_id
    where p.date_peremption <= aujourdhui + g.jours_alerte
    group by g.user_id, g.ntfy_topic
  loop
    perform net.http_post(
      url := 'https://ntfy.sh',
      body := jsonb_build_object(
        'topic', r.ntfy_topic,
        'title', 'Périmo : ' || r.n || case when r.n > 1 then ' produits' else ' produit' end || ' à consommer',
        'message', r.message,
        'tags', jsonb_build_array(case when r.urgent then 'rotating_light' else 'warning' end),
        'priority', case when r.urgent then 4 else 3 end
      )
    );
  end loop;
end;
$$;

-- Seule la tâche planifiée peut lancer l'envoi
revoke execute on function public.envoyer_alertes_perimo() from public, anon, authenticated;

-- Tous les jours à 7h UTC (9h en été, 8h en hiver à Paris)
select cron.schedule('perimo-alertes', '0 7 * * *', 'select public.envoyer_alertes_perimo()');
