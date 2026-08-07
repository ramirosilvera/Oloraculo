-- Estructura de repago de bonos/ONs: bullet (default, todo el capital al vencimiento) o amortizable
-- (paga capital en cuotas antes del vencimiento). `valor_residual` es una FOTO manual del % del
-- nominal original que todavía queda por cobrar (1 = 100%, sin amortizar todavía) — no un
-- cronograma completo: no hay ninguna fuente (ni data912, verificado a mano contra su respuesta
-- real) que publique el cronograma de amortización, así que se carga a mano cuando el usuario lo
-- averigua (ficha técnica del bono / extracto del bróker tras la primera cuota).
-- Todo nullable u opcional: las posiciones que no son bonos, o bonos bullet, no se afectan
-- (amortizable default false, valor_residual null se trata como 1 en el motor).

alter table posiciones
  add column if not exists amortizable boolean not null default false,
  add column if not exists valor_residual numeric;

alter table posiciones drop constraint if exists valor_residual_rango;
alter table posiciones add constraint valor_residual_rango
  check (valor_residual is null or (valor_residual > 0 and valor_residual <= 1));

comment on column posiciones.amortizable is 'true = el bono paga capital en cuotas antes del vencimiento (no bullet). Afecta cómo se calculan TIR/duración/rendimiento corriente (ver engine/coupons.ts).';
comment on column posiciones.valor_residual is 'Fracción (0..1) del nominal original que todavía queda por cobrar — carga manual, es una foto puntual, no un cronograma. Solo se usa si amortizable = true; si es null se trata como 1 (sin amortizar / bullet).';
