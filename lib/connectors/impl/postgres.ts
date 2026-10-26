import { Client } from "pg";
import { z } from "zod";
import { classifyName, classifyValue, sensitivityOf, unique } from "../classify";
import type { ConnectorContext, ConnectorImpl, DiscoveredAsset, ScanResult, TestResult } from "../types";

const cfg = z.object({
  schemas: z.string().optional().default(""),
  sampleRows: z.coerce.number().int().min(0).max(1000).default(50),
});

const TEXTUAL = new Set(["character varying", "text", "character", "citext", "json", "jsonb", "name"]);
const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;

async function connect(ctx: ConnectorContext): Promise<Client> {
  const cs = ctx.secret?.connectionString;
  if (!cs) throw new Error("No connection string saved for this connector.");
  const client = new Client({ connectionString: cs, connectionTimeoutMillis: 10000, statement_timeout: 20000, application_name: "primus-privacy-scan" });
  await client.connect();
  // Everything the scanner does happens inside a read-only transaction.
  await client.query("BEGIN READ ONLY");
  return client;
}

export const postgresConnector: ConnectorImpl = {
  async test(ctx): Promise<TestResult> {
    let client: Client | undefined;
    try {
      client = await connect(ctx);
      const r = await client.query(`SELECT current_database() AS db, (SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')) AS tables`);
      return { ok: true, message: `Connected (read-only) to "${r.rows[0].db}"; ${r.rows[0].tables} table(s) visible.` };
    } catch (e) {
      return { ok: false, message: `Could not connect: ${(e as Error).message}`.slice(0, 300) };
    } finally {
      await client?.end().catch(() => undefined);
    }
  },

  async scan(ctx): Promise<ScanResult> {
    const c = cfg.parse(ctx.config);
    const wanted = c.schemas.split(",").map((s) => s.trim()).filter(Boolean);
    const client = await connect(ctx);
    try {
      const cols = await client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
        `SELECT c.table_schema, c.table_name, c.column_name, c.data_type
           FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
          WHERE c.table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
            AND c.table_schema NOT LIKE 'pg\\_%'
            AND ($1::text[] IS NULL OR c.table_schema = ANY($1))
          ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
        [wanted.length ? wanted : null],
      );
      const est = await client.query<{ schema: string; name: string; est: string }>(
        `SELECT n.nspname AS schema, c.relname AS name, c.reltuples::bigint::text AS est
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r'`,
      );
      const estimate = new Map(est.rows.map((r) => [`${r.schema}.${r.name}`, Math.max(0, Number(r.est))]));

      const tables = new Map<string, Array<{ name: string; type: string }>>();
      for (const r of cols.rows) {
        const k = `${r.table_schema}.${r.table_name}`;
        if (!tables.has(k)) tables.set(k, []);
        tables.get(k)!.push({ name: r.column_name, type: r.data_type });
      }

      const assets: DiscoveredAsset[] = [];
      let sampled = 0, withPii = 0, sampleErrors = 0;
      for (const [loc, columns] of tables) {
        const [schema, ...rest] = loc.split(".");
        const table = rest.join(".");
        const perColumn = new Map<string, Set<string>>();
        for (const col of columns) perColumn.set(col.name, new Set(classifyName(col.name)));

        if (c.sampleRows > 0) {
          const textCols = columns.filter((x) => TEXTUAL.has(x.type)).slice(0, 25);
          if (textCols.length) {
            try {
              const sql = `SELECT ${textCols.map((x) => `${quote(x.name)}::text AS ${quote(x.name)}`).join(", ")} FROM ${quote(schema!)}.${quote(table)} LIMIT ${c.sampleRows}`;
              const rows = await client.query(sql);
              sampled++;
              for (const row of rows.rows) {
                for (const col of textCols) {
                  const v = row[col.name];
                  if (typeof v === "string" && v.length < 2000) for (const cat of classifyValue(v)) perColumn.get(col.name)!.add(cat);
                }
              }
              // `rows` goes out of scope here; no value is stored anywhere.
            } catch {
              sampleErrors++;
              await client.query("ROLLBACK").catch(() => undefined);
              await client.query("BEGIN READ ONLY");
            }
          }
        }

        const colInfo = columns.map((x) => ({ name: x.name, type: x.type, categories: unique([...(perColumn.get(x.name) ?? [])]) }));
        const cats = unique(colInfo.flatMap((x) => x.categories));
        if (cats.length) withPii++;
        assets.push({
          assetType: "table", name: table, location: loc,
          attributes: { columns: colInfo, columnCount: columns.length, estimatedRows: estimate.get(loc) ?? null, sampledValues: c.sampleRows > 0 },
          piiCategories: cats, sensitivity: sensitivityOf(cats),
        });
      }
      return { assets, stats: { tables: tables.size, tablesWithPersonalData: withPii, tablesSampled: sampled, sampleErrors } };
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  },
};
