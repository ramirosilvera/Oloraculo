-- Metadata de cupón para bonos/ONs, necesaria para el flujo de cupones (calendario mensual).
-- Todo nullable: las posiciones que no son bonos (o bonos sin datos cargados) no se afectan.

alter table posiciones
  add column if not exists cupon_tasa numeric,        -- tasa nominal ANUAL (ej. 0.07 = 7%)
  add column if not exists cupon_frecuencia int,      -- pagos por año (2 = semestral, 4 = trimestral, 1 = anual)
  add column if not exists cupon_mes int,             -- mes (1-12) de un pago de referencia; el resto se derivan
  add column if not exists vencimiento date;          -- fecha de vencimiento (corta el calendario)

comment on column posiciones.cupon_tasa is 'Tasa nominal anual del cupón (0.07 = 7%). El cupón por período = nominal × cupon_tasa / cupon_frecuencia.';
comment on column posiciones.cupon_frecuencia is 'Pagos de cupón por año (1 anual, 2 semestral, 4 trimestral).';
comment on column posiciones.cupon_mes is 'Mes (1-12) de un pago de referencia; los demás se derivan por 12/frecuencia.';
