import type { InlineKeyboardMarkup } from "./types";

interface TelegramApiResponse {
	ok: boolean;
	description?: string;
}

export interface TelegramMessenger {
	sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void>;
	answerCallbackQuery(callbackQueryId: string): Promise<void>;
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

	private async call(method: string, payload: Record<string, unknown>): Promise<void> {
		const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
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
