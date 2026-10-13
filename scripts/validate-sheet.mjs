// Operator entry point: runs the TypeScript script through Vite's module
// runner, so it shares the services' extensionless imports with no new
// dependency. Exit code: 0 clean, 1 problems found, 2 could not run.
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

try {
  const { module } = await runnerImport(
    fileURLToPath(new URL('./validate-sheet.ts', import.meta.url)),
    { configFile: false, logLevel: 'error' }
  );
  process.exitCode = await module.main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
