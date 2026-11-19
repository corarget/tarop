import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

const LOCAL_D1_ID = "11111111-1111-4111-8111-111111111111";

export default defineConfig(({ mode }) => ({
	worker: {
		name: "tarop",
		compatibilityDate: "2026-11-19",
		entrypoint,
		env: {
			DB: bindings.d1({
				name: "tarop-db",
				...(mode === "development" ? { id: LOCAL_D1_ID } : {}),
			}),
			TELEGRAM_BOT_TOKEN: bindings.secret(),
			TELEGRAM_WEBHOOK_SECRET: bindings.secret(),
			AI_API_KEY: bindings.secret(),
			AI: mode === "production" ? bindings.ai() : bindings.json(null),
			AI_MODE: bindings.text(mode === "production" ? "workers-ai" : "mock"),
			AI_BASE_URL: bindings.text("https://api.openai.com/v1"),
			AI_MODEL: bindings.text("gpt-4.1-mini"),
			FREE_READING_LIMIT: bindings.text(mode === "production" ? "6" : "1"),
			TEST_TELEGRAM_IDS: bindings.text(""),
		},
		observability: {
			enabled: true,
			logs: { enabled: true, headSamplingRate: 1 },
			traces: { enabled: true, headSamplingRate: 0.05 },
		},
	},
}));
