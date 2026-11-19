import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			config: true,
			miniflare: {
				bindings: {
					TELEGRAM_BOT_TOKEN: "test-bot-token",
					TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
					AI_API_KEY: "test-ai-key",
					TEST_MIGRATIONS: await readD1Migrations(
						path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations"),
					),
				},
			},
		})),
	],
	test: {
		setupFiles: ["./test/apply-migrations.ts"],
	},
});
