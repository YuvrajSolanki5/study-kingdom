import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export interface DbOptions {
  url: string;
  prepare?: boolean;
  /** Private CA for direct Node connections; Hyperdrive validates its origin. */
  caCertificate?: string;
}

/**
 * One client per request: Workers cannot share sockets between requests.
 * int8 columns are parsed as numbers (balances stay far below 2^53).
 */
export function createSql({ url, prepare = true, caCertificate }: DbOptions): Sql {
  const sslMode = new URL(url).searchParams.get('sslmode');
  return postgres(url, {
    ...(sslMode && sslMode !== 'disable'
      ? { ssl: { rejectUnauthorized: true, ...(caCertificate ? { ca: caCertificate } : {}) } }
      : {}),
    max: 1,
    prepare,
    fetch_types: false,
    idle_timeout: 5,
    connect_timeout: 10,
    connection: { search_path: 'game, public', application_name: 'study-kingdom-api' },
    types: {
      int8: {
        to: 20,
        from: [20],
        serialize: (v: number) => String(v),
        parse: (v: string) => Number(v),
      },
      // Calendar dates stay plain YYYY-MM-DD strings (no time zone shifts).
      date: {
        to: 1082,
        from: [1082],
        serialize: (v: string) => v,
        parse: (v: string) => v,
      },
    },
  });
}

const RETRYABLE = new Set(['40001', '40P01']);

/** Runs a transaction, retrying serialization failures and deadlocks. */
export async function transaction<T>(sql: Sql, fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return (await sql.begin((tx) => fn(tx))) as T;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (i >= attempts || !code || !RETRYABLE.has(code)) throw e;
    }
  }
}
