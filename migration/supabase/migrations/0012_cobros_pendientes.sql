-- Soporte para cobros generados AUTOMÁTICAMENTE por el cron (dividendos reales vía FMP para
-- CEDEARs/acciones, cupones sintéticos vía engine/coupons.ts para bonos): nunca se auto-confirman,
-- entran en estado 'pendiente' y el usuario los revisa uno por uno antes de que cuenten como plata
-- realmente cobrada (ver engine/cobros.ts — 'pendiente' se excluye explícitamente de los totales).
--
-- origen distingue una fila cargada a mano de una que puso el cron, para poder deduplicar SOLO
-- las del cron sin bloquear que el usuario cargue dos cobros reales con la misma fecha (ej. un
-- dividendo especial el mismo día que el ordinario).

alter table public.cobros add column if not exists origen text not null default 'manual' check (origen in ('manual', 'cron'));

alter table public.cobros drop constraint if exists cobros_estado_check;
alter table public.cobros add constraint cobros_estado_check check (estado in ('disponible', 'reinvertido', 'pendiente'));

-- Idempotencia del cron: reintentar (o correr dos veces el mismo día) no debe duplicar el mismo
-- evento. Solo aplica a origen='cron' — un cobro cargado a mano nunca choca contra esto.
create unique index if not exists cobros_cron_dedupe
  on public.cobros (posicion_id, tipo, fecha)
  where origen = 'cron';
