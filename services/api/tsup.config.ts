import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/server.ts', 'src/seed/create-staff.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  noExternal: ['@gdc/shared'],
  clean: true,
});
