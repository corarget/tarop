import { Repository } from "./db/repository";
import { createAiInterpreter } from "./llm";
import { constantTimeEqual } from "./security";
import { TelegramClient } from "./telegram/client";
import { TelegramUpdateHandler } from "./telegram/handler";
import type { TelegramUpdate } from "./telegram/types";

function parseFreeReadingLimit(value: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error("FREE_READING_LIMIT must be a non-negative integer");
	}
	return parsed;
}

function parseTestTelegramIds(value: string): Set<string> {
	return new Set(
		value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean),
	);
}

function isTelegramUpdate(value: unknown): value is TelegramUpdate {
	return (
		typeof value === "object" &&
		value !== null &&
		"update_id" in value &&
		Number.isInteger((value as { update_id?: unknown }).update_id)
	);
}

export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
	const providedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
	if (!(await constantTimeEqual(providedSecret, env.TELEGRAM_WEBHOOK_SECRET))) {
		return new Response("Unauthorized", { status: 401 });
	}

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	if (!isTelegramUpdate(payload)) {
		return new Response("Invalid Telegram update", { status: 400 });
	}

	const repository = new Repository(env.DB);
	if (!(await repository.claimUpdate(payload.update_id))) {
		return Response.json({ ok: true, duplicate: true });
	}

	try {
		const handler = new TelegramUpdateHandler(
			repository,
			new TelegramClient(env.TELEGRAM_BOT_TOKEN),
			createAiInterpreter(env),
			{
				freeReadingLimit: parseFreeReadingLimit(env.FREE_READING_LIMIT),
				testTelegramIds: parseTestTelegramIds(env.TEST_TELEGRAM_IDS),
			},
		);
		await handler.handle(payload);
		await repository.finishUpdate(payload.update_id);
		return Response.json({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await repository.failUpdate(payload.update_id, message);
		console.error(
			JSON.stringify({
				message: "Telegram update failed",
				updateId: payload.update_id,
				error: message,
			}),
		);
		return Response.json({ ok: false, error: "Internal server error" }, { status: 500 });
	}
}
