// Espejo (frontend) del DEFAULT_CIK del servidor (functions/api/_edgar.ts). El backend resuelve
// el CIK por defecto a partir del ticker, pero el frontend necesita conocerlo para HABILITAR el
// fetch de fundamentals y para saber cuándo un ticker realmente no tiene CIK. Mantener en sync.
export const DEFAULT_CIK: Record<string, string> = {
  UNH: '0000731766', MA: '0001141391', MSFT: '0000789019', GOOGL: '0001652044',
  MRK: '0000310158', MELI: '0001099590', LAC: '0001966983', ADBE: '0000796343',
  AMZN: '0001018724', ACN: '0001467373', NKE: '0000320187', AAPL: '0000320193',
  ASML: '0000937966', KO: '0000021344', V: '0001403161', WMT: '0000104169',
  NVDA: '0001045810', META: '0001326801', JNJ: '0000200406', PG: '0000080424',
  PEP: '0000077476', COST: '0000909832', LLY: '0000059478', JPM: '0000019617',
};
