// =============================================================================
// Simulation Web Worker
// Runs the Monte Carlo engine off the main thread to keep the UI responsive
// =============================================================================

import { runSimulation, type SimulationInput } from '../engine/simulation-engine';
import type { TournamentProjection } from '../types/domain';

self.onmessage = (event: MessageEvent<SimulationInput>) => {
  try {
    const result: TournamentProjection = runSimulation(event.data);
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
