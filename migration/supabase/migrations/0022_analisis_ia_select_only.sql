-- ===========================================================================
-- ia_own (0001_portfolio_schema.sql) le daba al cliente INSERT/UPDATE/DELETE sobre analisis_ia,
-- incluso para filas con portfolio_id IS NULL (sin owns_portfolio() de por medio — esas son cache
-- global de análisis "macro"). El cliente nunca usó esas vías: todo INSERT/UPDATE real viene del
-- service-role en functions/api/analysis/*.ts (sbUpsert, bypassa RLS) — src/hooks/useAnalisisIA.ts
-- solo hace SELECT. Achicar a SELECT-only no rompe nada y cierra una escritura directa que una
-- cuenta sin aprobar podía hacer igual (hallazgo de la revisión de seguridad de 0021).
-- ===========================================================================

drop policy if exists ia_own on public.analisis_ia;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='analisis_ia' and policyname='ia_select') then
    create policy ia_select on public.analisis_ia for select to authenticated
      using (portfolio_id is null or public.owns_portfolio(portfolio_id));
  end if;
end $$;
