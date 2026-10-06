import { execSync } from 'child_process';
import * as path from 'path';

/** Rebuild the test database from migrations for every run (this also verifies migrations on a clean DB). */
export default async function globalSetup() {
  process.env.NODE_ENV = 'test';
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://tablya:tablya_dev@localhost:5432/tablya_test';
  const env = { ...process.env, DATABASE_URL: url };
  execSync(`psql "${url}" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`, { stdio: 'inherit', env });
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', env });
}
