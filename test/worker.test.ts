import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";

describe("Worker HTTP routes", () => {
	it("reports health", async () => {
		const response = await SELF.fetch("https://example.com/health");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok" });
	});

	it("rejects a Telegram webhook with the wrong secret", async () => {
		const response = await SELF.fetch("https://example.com/telegram/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Telegram-Bot-Api-Secret-Token": "wrong-secret",
			},
			body: JSON.stringify({ update_id: 1 }),
		});

		expect(response.status).toBe(401);
	});
});
