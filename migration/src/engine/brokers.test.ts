import { describe, it, expect } from 'vitest';
import { resumenPorBroker } from './brokers';

const brokers = [{ id: 'iol', nombre: 'IOL' }, { id: 'san', nombre: 'Santander' }];

describe('resumenPorBroker', () => {
  it('sin posiciones → lista vacía', () => {
    expect(resumenPorBroker([], brokers)).toEqual([]);
  });

  it('agrupa por broker y suma el valor', () => {
    const r = resumenPorBroker([
      { brokerId: 'iol', valorUsd: 100 }, { brokerId: 'iol', valorUsd: 50 }, { brokerId: 'san', valorUsd: 30 },
    ], brokers);
    const iol = r.find(x => x.brokerId === 'iol')!;
    const san = r.find(x => x.brokerId === 'san')!;
    expect(iol.valorUsd).toBe(150);
    expect(iol.cantidadPosiciones).toBe(2);
    expect(san.valorUsd).toBe(30);
  });

  it('calcula el % correctamente sobre el total', () => {
    const r = resumenPorBroker([{ brokerId: 'iol', valorUsd: 75 }, { brokerId: 'san', valorUsd: 25 }], brokers);
    expect(r.find(x => x.brokerId === 'iol')!.pct).toBeCloseTo(0.75, 9);
    expect(r.find(x => x.brokerId === 'san')!.pct).toBeCloseTo(0.25, 9);
  });

  it('posiciones sin broker (brokerId null) van a "Sin asignar"', () => {
    const r = resumenPorBroker([{ brokerId: null, valorUsd: 40 }, { brokerId: 'iol', valorUsd: 60 }], brokers);
    const sinAsignar = r.find(x => x.brokerId === null)!;
    expect(sinAsignar.nombre).toBe('Sin asignar');
    expect(sinAsignar.valorUsd).toBe(40);
  });

  it('"Sin asignar" siempre queda al final, aunque tenga más valor que los brokers reales', () => {
    const r = resumenPorBroker([{ brokerId: null, valorUsd: 1000 }, { brokerId: 'iol', valorUsd: 10 }], brokers);
    expect(r[r.length - 1].brokerId).toBeNull();
  });

  it('ordena de mayor a menor valor (entre brokers reales)', () => {
    const r = resumenPorBroker([{ brokerId: 'san', valorUsd: 10 }, { brokerId: 'iol', valorUsd: 90 }], brokers);
    expect(r[0].brokerId).toBe('iol');
    expect(r[1].brokerId).toBe('san');
  });

  it('un broker_id que ya no existe en la lista de brokers (borrado) no rompe, muestra "Broker eliminado"', () => {
    const r = resumenPorBroker([{ brokerId: 'ya-no-existe', valorUsd: 20 }], brokers);
    expect(r[0].nombre).toBe('Broker eliminado');
  });

  it('total en 0 → pct en 0, no divide por cero', () => {
    const r = resumenPorBroker([{ brokerId: 'iol', valorUsd: 0 }], brokers);
    expect(r[0].pct).toBe(0);
  });
});
