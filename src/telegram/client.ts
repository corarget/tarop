import { SPREAD_COVER } from "../tarot/spread-cover";
import type { InlineKeyboardMarkup } from "./types";

interface TelegramApiResponse {
	ok: boolean;
	description?: string;
}

export interface TelegramMessenger {
	sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void>;
	answerCallbackQuery(callbackQueryId: string): Promise<void>;
	sendSpreadCover(chatId: number, caption: string, keyboard: InlineKeyboardMarkup): Promise<void>;
	sendCardAlbum(chatId: number, cards: readonly CardPhoto[]): Promise<void>;
	removeKeyboard(chatId: number, messageId: number): Promise<void>;
}

export interface CardPhoto {
	url: string;
	caption: string;
}

export class TelegramClient implements TelegramMessenger {
	constructor(private readonly token: string) {}

	async sendMessage(
		chatId: number,
		text: string,
		replyMarkup?: InlineKeyboardMarkup,
	): Promise<void> {
		await this.call("sendMessage", {
			chat_id: chatId,
			text,
			...(replyMarkup ? { reply_markup: replyMarkup } : {}),
		});
	}

	async answerCallbackQuery(callbackQueryId: string): Promise<void> {
		await this.call("answerCallbackQuery", {
			callback_query_id: callbackQueryId,
		});
	}

	async sendSpreadCover(
		chatId: number,
		caption: string,
		keyboard: InlineKeyboardMarkup,
	): Promise<void> {
		const form = new FormData();
		form.set("chat_id", String(chatId));
		form.set("caption", caption);
		form.set("reply_markup", JSON.stringify(keyboard));
		const bytes = Uint8Array.from(atob(SPREAD_COVER), (value) => value.charCodeAt(0));
		form.set("photo", new Blob([bytes], { type: "image/png" }), "tarop-spread.png");
		await this.call("sendPhoto", form);
	}

	async sendCardAlbum(chatId: number, cards: readonly CardPhoto[]): Promise<void> {
		await this.call("sendMediaGroup", {
			chat_id: chatId,
			media: cards.map(({ url, caption }) => ({ type: "photo", media: url, caption })),
		});
	}

	async removeKeyboard(chatId: number, messageId: number): Promise<void> {
		await this.call("editMessageReplyMarkup", {
			chat_id: chatId,
			message_id: messageId,
			reply_markup: { inline_keyboard: [] },
		});
	}

	private async call(method: string, payload: Record<string, unknown> | FormData): Promise<void> {
		const requestBody =
			payload instanceof FormData
				? { body: payload }
				: {
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(payload),
					};
		const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
			method: "POST",
			...requestBody,
			signal: AbortSignal.timeout(10_000),
		});

		const result = await response.json<TelegramApiResponse>();
		if (!response.ok || !result.ok) {
			throw new Error(
				`Telegram method ${method} failed with HTTP ${response.status}: ${result.description ?? "unknown error"}`,
			);
		}
	}
}
