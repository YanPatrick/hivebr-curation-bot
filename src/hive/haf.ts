import { Pool } from "pg";

type RankedDelegator = {
  delegator: string;
  amount: number;
};

const REQUEST_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// hafsql-api.mahdiyari.info (the old REST API) was shut down/archived, so we
// query the public HafSQL Postgres database directly instead. These are the
// maintainer's published anonymous read-only credentials, not a secret:
// https://mahdiyari.gitlab.io/hafsql/
const pool = new Pool({
  host: "hafsql-sql.mahdiyari.info",
  port: 5432,
  database: "haf_block_log",
  user: "hafsql_public",
  password: "hafsql_public",
  query_timeout: REQUEST_TIMEOUT_MS,
  connectionTimeoutMillis: REQUEST_TIMEOUT_MS,
  max: 3,
  idleTimeoutMillis: 30000,
});

// Falls back to the last successful fetch when the API is flaky, so a
// transient outage doesn't get displayed as "Not Ranked" for real delegators.
let cachedRankedDelegators: RankedDelegator[] | null = null;

// Circuit breaker: after 5 consecutive failures, stop hammering the database
// for 60s instead of retrying on every single rank lookup.
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60000;
const circuit = { failures: 0, openUntil: 0 };

function circuitOpen(): boolean {
  if (circuit.failures < CIRCUIT_FAILURE_THRESHOLD) return false;
  if (Date.now() >= circuit.openUntil) {
    // Cooldown expired — allow one probe through.
    circuit.failures = 0;
    return false;
  }
  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRankedDelegators(): Promise<RankedDelegator[]> {
  const communityAccount = 'hive-br.voter';

  if (circuitOpen()) {
    if (cachedRankedDelegators) return cachedRankedDelegators;
    throw new Error('HafSQL database unavailable — circuit open');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await pool.query<{ delegator: string; vests: string }>(
        `SELECT delegator, vests FROM hafsql.delegations WHERE delegatee = $1`,
        [communityAccount]
      );
      const rankedDelegators = result.rows
        .map((d) => ({
          delegator: d.delegator,
          amount: parseFloat(d.vests),
        }))
        .sort((a, b) => b.amount - a.amount);

      cachedRankedDelegators = rankedDelegators;
      circuit.failures = 0;
      return rankedDelegators;
    } catch (error) {
      lastError = error;
      circuit.failures++;
      circuit.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      if (attempt < MAX_ATTEMPTS && !circuitOpen()) {
        await sleep(RETRY_DELAY_MS * attempt);
      } else {
        break;
      }
    }
  }

  console.error(`Error fetching delegations from HafSQL database after ${MAX_ATTEMPTS} attempts:`, lastError);
  if (cachedRankedDelegators) {
    console.error('Falling back to last known delegation snapshot.');
    return cachedRankedDelegators;
  }
  throw lastError;
}

export async function getAuthorDelegationRank(author: string): Promise<number | null> {
  try {
    const rankedDelegators = await fetchRankedDelegators();
    const authorRank = rankedDelegators.findIndex((d) => d.delegator === author);
    return authorRank !== -1 ? authorRank + 1 : null;
  } catch (error) {
    console.error(`Error fetching delegation rank for @${author}:`, error);
    return null;
  }
}