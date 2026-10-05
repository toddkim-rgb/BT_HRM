/**
 * Turso(운영 DB) 관리 스크립트 — Prisma migrate는 Turso를 직접 지원하지 않아 SQL을 직접 적용
 *
 *   npx tsx --env-file=.env.turso scripts/turso.ts migrate   # prisma/migrations/*.sql 중 미적용분 적용
 *   npx tsx --env-file=.env.turso scripts/turso.ts import    # 로컬 dev.db 데이터를 Turso로 복사 (빈 DB에서 1회)
 *   npx tsx --env-file=.env.turso scripts/turso.ts status    # 테이블별 건수
 *
 * .env.turso (git·Vercel 업로드 제외): TURSO_DATABASE_URL=libsql://...  TURSO_AUTH_TOKEN=...
 */
import { createClient, type InStatement } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL 이 없습니다 (.env.turso)');
const remote = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const migrationsDir = path.resolve(import.meta.dirname, '../prisma/migrations');

async function migrate() {
  await remote.execute('CREATE TABLE IF NOT EXISTS "_turso_migrations" (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await remote.execute('SELECT name FROM "_turso_migrations"')).rows.map((r) => String(r.name)));
  const dirs = fs.readdirSync(migrationsDir).filter((d) => fs.existsSync(path.join(migrationsDir, d, 'migration.sql'))).sort();
  for (const d of dirs) {
    if (done.has(d)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, d, 'migration.sql'), 'utf8');
    // Prisma의 SQLite 테이블 재생성 마이그레이션은 PRAGMA foreign_keys 토글을 쓰므로 트랜잭션 밖에서 순서대로 실행
    await remote.executeMultiple(sql);
    await remote.execute({ sql: 'INSERT INTO "_turso_migrations" VALUES (?, ?)', args: [d, new Date().toISOString()] });
    console.log('적용:', d);
  }
  console.log('마이그레이션 완료');
}

const userTables = async (c: ReturnType<typeof createClient>) =>
  (await c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'")).rows.map((r) => String(r.name));

async function importLocal() {
  const local = createClient({ url: 'file:' + path.resolve(import.meta.dirname, '../prisma/dev.db') });
  const tables = await userTables(local);
  for (const t of await userTables(remote)) {
    const n = Number((await remote.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
    if (n > 0) throw new Error(`Turso의 ${t} 테이블에 이미 데이터가 있습니다 (${n}건). 빈 DB에서만 가져옵니다.`);
  }
  // 외래키는 트랜잭션 끝에서 검사 (테이블 순서와 무관하게 복사)
  const stmts: InStatement[] = ['PRAGMA defer_foreign_keys = ON'];
  for (const t of tables) {
    const rs = await local.execute(`SELECT * FROM "${t}"`);
    for (const row of rs.rows) {
      const cols = rs.columns;
      stmts.push({ sql: `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, args: cols.map((c) => row[c] as never) });
    }
    console.log(`${t}: ${rs.rows.length}건`);
  }
  await remote.batch(stmts, 'write');
  console.log('데이터 가져오기 완료');
}

async function status() {
  for (const t of await userTables(remote)) console.log(t, Number((await remote.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n));
}

const cmd = process.argv[2];
if (cmd === 'migrate') await migrate();
else if (cmd === 'import') await importLocal();
else if (cmd === 'status') await status();
else console.log('사용법: scripts/turso.ts migrate | import | status');
