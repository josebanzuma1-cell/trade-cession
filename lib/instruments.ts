/**
 * The instruments this dashboard covers, and how each one maps onto the two
 * free data sources: Yahoo for prices, and the CFTC's Commitments of Traders
 * report for positioning.
 */
export interface Instrument {
  id: string;
  label: string;
  /** Yahoo Finance symbol. */
  yahoo: string;
  /** CFTC `market_and_exchange_names`, or null where no contract maps cleanly. */
  cot: string | null;
  /**
   * True where a long futures position means a SHORT position in the pair as
   * a retail trader quotes it.
   *
   * Yen futures are the trap: they are quoted as USD per JPY, the inverse of
   * the USDJPY you trade. Funds being net long yen futures means they are
   * short USDJPY. Reporting that as "long" would invert the read on every
   * yen alert, so it is corrected here rather than anywhere downstream.
   */
  cotInvert: boolean;
  digits: number;
  /** An Asian range only means something for instruments that trade through it. */
  hasAsianRange: boolean;
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: "EURUSD",
    label: "EUR/USD",
    yahoo: "EURUSD=X",
    cot: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    cotInvert: false,
    digits: 5,
    hasAsianRange: true,
  },
  {
    id: "GBPUSD",
    label: "GBP/USD",
    yahoo: "GBPUSD=X",
    cot: "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE",
    cotInvert: false,
    digits: 5,
    hasAsianRange: true,
  },
  {
    id: "USDJPY",
    label: "USD/JPY",
    yahoo: "USDJPY=X",
    cot: "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",
    cotInvert: true,
    digits: 3,
    hasAsianRange: true,
  },
  {
    id: "XAUUSD",
    label: "Gold",
    yahoo: "GC=F",
    cot: "GOLD - COMMODITY EXCHANGE INC.",
    cotInvert: false,
    digits: 2,
    hasAsianRange: true,
  },
  {
    id: "US30",
    label: "US30 (Dow)",
    yahoo: "^DJI",
    cot: "DJIA Consolidated - CHICAGO BOARD OF TRADE",
    cotInvert: false,
    digits: 0,
    // Cash index, so it simply does not trade during the Asian session.
    hasAsianRange: false,
  },
  {
    id: "NAS100",
    label: "NAS100",
    yahoo: "^NDX",
    cot: "NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE",
    cotInvert: false,
    digits: 0,
    hasAsianRange: false,
  },
];

export const INSTRUMENT_BY_ID = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.id, i]),
) as Record<string, Instrument>;
