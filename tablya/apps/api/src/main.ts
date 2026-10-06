import { createApp } from './bootstrap';

async function main() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
