/**
 * In-memory stand-in for the slice of supabase-js the repository functions
 * use: `from(table)` with select / insert / upsert (onConflict) / update /
 * delete, `eq` / `in` filters, `order`, `single` / `maybeSingle`, plus
 * injectable `functions.invoke` and `storage.from().download()`. Test-only.
 */
import type { Db } from '../client.js';

export type Rec = Record<string, unknown>;

interface Result {
  data: unknown;
  error: { message: string } | null;
}

type Op =
  | { kind: 'select' }
  | { kind: 'insert'; rows: Rec[] }
  | { kind: 'upsert'; rows: Rec[]; keys: string[] }
  | { kind: 'update'; patch: Rec }
  | { kind: 'delete' };

class Query implements PromiseLike<Result> {
  private op: Op = { kind: 'select' };
  private readonly filters: ((r: Rec) => boolean)[] = [];
  private returning = false;
  private cardinality: 'many' | 'single' | 'maybe' = 'many';

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(): this {
    if (this.op.kind !== 'select') this.returning = true;
    return this;
  }
  insert(rows: Rec | Rec[]): this {
    this.op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  upsert(rows: Rec | Rec[], opts: { onConflict: string }): this {
    this.op = {
      kind: 'upsert',
      rows: Array.isArray(rows) ? rows : [rows],
      keys: opts.onConflict.split(','),
    };
    return this;
  }
  update(patch: Rec): this {
    this.op = { kind: 'update', patch };
    return this;
  }
  delete(): this {
    this.op = { kind: 'delete' };
    return this;
  }
  eq(col: string, v: unknown): this {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  in(col: string, vs: readonly unknown[]): this {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  order(): this {
    return this;
  }
  single(): this {
    this.cardinality = 'single';
    return this;
  }
  maybeSingle(): this {
    this.cardinality = 'maybe';
    return this;
  }

  private run(): Result {
    const rows = this.db.table(this.table);
    const match = (r: Rec) => this.filters.every((f) => f(r));
    let out: Rec[] = [];
    switch (this.op.kind) {
      case 'select':
        out = rows.filter(match);
        break;
      case 'insert':
        rows.push(...this.op.rows.map((r) => ({ ...r })));
        out = this.op.rows;
        break;
      case 'upsert': {
        const keys = this.op.keys;
        for (const r of this.op.rows) {
          const i = rows.findIndex((x) => keys.every((k) => x[k] === r[k]));
          if (i >= 0) rows[i] = { ...rows[i], ...r };
          else rows.push({ ...r });
        }
        out = this.op.rows;
        break;
      }
      case 'update': {
        for (let i = 0; i < rows.length; i++) {
          if (match(rows[i]!)) {
            rows[i] = { ...rows[i], ...this.op.patch };
            out.push(rows[i]!);
          }
        }
        break;
      }
      case 'delete': {
        out = rows.filter(match);
        this.db.tables[this.table] = rows.filter((r) => !match(r));
        break;
      }
    }
    this.db.log.push({ table: this.table, op: this.op.kind });
    const data = this.op.kind === 'select' || this.returning ? out : null;
    if (this.cardinality === 'many') return { data, error: null };
    const first = data?.[0] ?? null;
    if (this.cardinality === 'single' && !first) {
      return { data: null, error: { message: 'no rows' } };
    }
    return { data: first, error: null };
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }
}

export class FakeDb {
  tables: Record<string, Rec[]>;
  log: { table: string; op: string }[] = [];
  invoke: (name: string, opts?: unknown) => Promise<Result> = () =>
    Promise.resolve({ data: null, error: { message: 'no functions in FakeDb' } });
  files: Record<string, Uint8Array> = {};

  constructor(tables: Record<string, Rec[]> = {}) {
    this.tables = tables;
  }

  table(name: string): Rec[] {
    return (this.tables[name] ??= []);
  }

  from(table: string): Query {
    return new Query(this, table);
  }

  get functions() {
    return { invoke: (name: string, opts?: unknown) => this.invoke(name, opts) };
  }

  get storage() {
    return {
      from: () => ({
        download: (path: string) => {
          const bytes = this.files[path];
          return Promise.resolve(
            bytes
              ? { data: new Blob([bytes as BlobPart]), error: null }
              : { data: null, error: { message: 'not found' } },
          );
        },
      }),
    };
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}
