import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";
import { Repository } from "../src/db/repository";
import type { AiInterpreter, InterpretationInput, QuestionInput } from "../src/llm/types";
import type { CardPhoto, TelegramMessenger } from "../src/telegram/client";
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
	readonly albums: (readonly CardPhoto[])[] = [];

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

	async sendSpreadCover(
		chatId: number,
		caption: string,
		keyboard: InlineKeyboardMarkup,
	): Promise<void> {
		await this.sendMessage(chatId, caption, keyboard);
	}

	async sendCardAlbum(_chatId: number, cards: readonly CardPhoto[]): Promise<void> {
		this.albums.push(cards);
	}

	async removeKeyboard(): Promise<void> {}
}

class FakeAi implements AiInterpreter {
	readonly calls: InterpretationInput[] = [];

	async clarify(input: QuestionInput): Promise<string> {
		return input.topic.id === "relationships" ? "Что произошло перед вашей паузой?" : "";
	}

	async interpret(input: InterpretationInput): Promise<string> {
		this.calls.push(input);
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
		const ai = new FakeAi();
		const handler = new TelegramUpdateHandler(repository, telegram, ai, {
			freeReadingLimit: 1,
			testTelegramIds: new Set(),
		});

		await handler.handle(messageUpdate(101, "/start"));
		await handler.handle(callbackUpdate(102, "persona:mira"));
		await handler.handle(callbackUpdate(103, "topic:relationships"));
		await handler.handle(messageUpdate(104, "Что мне важно понять об этих отношениях сейчас?"));
		expect(telegram.messages.at(-1)?.text).toBe("Что произошло перед вашей паузой?");
		expect(ai.calls).toHaveLength(0);
		await handler.handle(messageUpdate(105, "Мы перестали разговаривать после ссоры."));
		const active = await repository.getUserByTelegramId(String(telegramUser.id));
		const draft = JSON.parse(active?.draft_json ?? "{}");
		const selected = telegram.messages.at(-1)?.replyMarkup?.inline_keyboard[0]?.[1]?.callback_data;
		expect(selected).toBe(`open:${draft.id}:1`);
		expect(ai.calls).toHaveLength(0);
		await handler.handle(callbackUpdate(106, selected ?? ""));
		await handler.handle(callbackUpdate(107, selected ?? ""));
		expect(ai.calls).toHaveLength(1);
		expect(ai.calls[0]?.context).toBe("Мы перестали разговаривать после ссоры.");
		expect(ai.calls[0]?.question).toBe("Что мне важно понять об этих отношениях сейчас?");
		expect(ai.calls[0]?.cards[0]?.card.id).toBe(draft.cards[1].card.id);

		const user = await repository.getUserByTelegramId(String(telegramUser.id));
		expect(user).not.toBeNull();
		expect(await repository.getUsage(user?.id ?? "")).toBe(1);

		const history = await repository.listHistory(user?.id ?? "");
		expect(history).toHaveLength(1);
		expect(history[0]?.persona_id).toBe("mira");
		expect(history[0]?.topic).toBe("relationships");
		expect(history[0]?.result_text).toContain("Тестовая интерпретация");
		expect(telegram.albums[0]).toHaveLength(3);
		expect(telegram.albums[0]?.[0]?.caption).toContain("Главное");

		await handler.handle(messageUpdate(108, "/new"));
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
