import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";
import { Repository } from "../src/db/repository";
import type { AiInterpreter } from "../src/llm/types";
import type { TelegramMessenger } from "../src/telegram/client";
import { TelegramUpdateHandler } from "../src/telegram/handler";
import type { InlineKeyboardMarkup, TelegramUpdate } from "../src/telegram/types";

interface SentMessage {
	chatId: number;
	text: string;
	replyMarkup?: InlineKeyboardMarkup;
}

class FakeTelegram implements TelegramMessenger {
	readonly messages: SentMessage[] = [];
	readonly answeredCallbacks: string[] = [];

	async sendMessage(
		chatId: number,
		text: string,
		replyMarkup?: InlineKeyboardMarkup,
	): Promise<void> {
		this.messages.push({
			chatId,
			text,
			...(replyMarkup ? { replyMarkup } : {}),
		});
	}

	async answerCallbackQuery(callbackQueryId: string): Promise<void> {
		this.answeredCallbacks.push(callbackQueryId);
	}
}

class FakeAi implements AiInterpreter {
	async interpret(): Promise<string> {
		return "Тестовая интерпретация трёх карт.";
	}
}

const telegramUser = {
	id: 900_001,
	first_name: "Тест",
	username: "tester",
	language_code: "ru",
};

function messageUpdate(updateId: number, text: string): TelegramUpdate {
	return {
		update_id: updateId,
		message: {
			message_id: updateId,
			from: telegramUser,
			chat: { id: telegramUser.id, type: "private" },
			text,
		},
	};
}

function callbackUpdate(updateId: number, data: string): TelegramUpdate {
	return {
		update_id: updateId,
		callback_query: {
			id: `callback-${updateId}`,
			from: telegramUser,
			data,
			message: {
				message_id: updateId,
				chat: { id: telegramUser.id, type: "private" },
			},
		},
	};
}

describe("Telegram MVP flow", () => {
	it("selects a persona and topic, stores a reading, then enforces the limit", async () => {
		const repository = new Repository(env.DB);
		const telegram = new FakeTelegram();
		const handler = new TelegramUpdateHandler(repository, telegram, new FakeAi(), {
			freeReadingLimit: 1,
			testTelegramIds: new Set(),
		});

		await handler.handle(messageUpdate(101, "/start"));
		await handler.handle(callbackUpdate(102, "persona:mira"));
		await handler.handle(callbackUpdate(103, "topic:relationships"));
		await handler.handle(messageUpdate(104, "Что мне важно понять об этих отношениях сейчас?"));

		const user = await repository.getUserByTelegramId(String(telegramUser.id));
		expect(user).not.toBeNull();
		expect(await repository.getUsage(user?.id ?? "")).toBe(1);

		const history = await repository.listHistory(user?.id ?? "");
		expect(history).toHaveLength(1);
		expect(history[0]?.persona_id).toBe("mira");
		expect(history[0]?.topic).toBe("relationships");
		expect(history[0]?.result_text).toContain("Тестовая интерпретация");
		expect(telegram.messages.some((message) => message.text.includes("Ваши карты"))).toBe(true);

		await handler.handle(messageUpdate(105, "/new"));
		expect(telegram.messages.at(-1)?.text).toContain("Бесплатный лимит исчерпан");
	});

	it("does not claim the same webhook update twice", async () => {
		const repository = new Repository(env.DB);
		expect(await repository.claimUpdate(999_001)).toBe(true);
		expect(await repository.claimUpdate(999_001)).toBe(false);
		await repository.failUpdate(999_001, "temporary failure");
		expect(await repository.claimUpdate(999_001)).toBe(true);
	});
});
