import { Repository, type ReadingRecord, type UserRecord } from "../db/repository";
import type { AiInterpreter } from "../llm/types";
import { getPersona, PERSONAS, type Persona } from "../personas/catalog";
import { drawThreeCards, formatCards, type DrawnCard } from "../tarot/draw";
import { splitTelegramText } from "../text";
import { getTopic, TOPICS, type Topic } from "../topics";
import type { TelegramMessenger } from "./client";
import type {
	InlineKeyboardMarkup,
	TelegramCallbackQuery,
	TelegramMessage,
	TelegramUpdate,
} from "./types";

const INTRO = [
	"🔮 Добро пожаловать в Tarop.",
	"Здесь три виртуальные AI-консультантки помогают посмотреть на вопрос через символы Таро.",
	"Это инструмент для самоанализа, а не достоверное предсказание, медицинская, юридическая или финансовая рекомендация.",
].join("\n\n");

const PERSONA_KEYBOARD: InlineKeyboardMarkup = {
	inline_keyboard: PERSONAS.map((persona) => [
		{
			text: `${persona.name} — ${persona.shortBio}`,
			callback_data: `persona:${persona.id}`,
		},
	]),
};

const TOPIC_KEYBOARD: InlineKeyboardMarkup = {
	inline_keyboard: TOPICS.map((topic) => [
		{ text: topic.label, callback_data: `topic:${topic.id}` },
	]),
};

const AFTER_READING_KEYBOARD: InlineKeyboardMarkup = {
	inline_keyboard: [
		[{ text: "🔮 Новый расклад", callback_data: "action:new" }],
		[{ text: "📚 История", callback_data: "action:history" }],
	],
};

export interface HandlerOptions {
	freeReadingLimit: number;
	testTelegramIds: ReadonlySet<string>;
}

function isWhitelisted(telegramId: string, options: HandlerOptions): boolean {
	return options.testTelegramIds.has(telegramId);
}

function deserializeCards(serialized: string): DrawnCard[] {
	const parsed: unknown = JSON.parse(serialized);
	if (!Array.isArray(parsed) || parsed.length !== 3) {
		throw new Error("Stored reading contains invalid cards");
	}
	return parsed as DrawnCard[];
}

function getContext(update: TelegramUpdate): {
	message?: TelegramMessage;
	callback?: TelegramCallbackQuery;
} {
	return {
		...(update.message ? { message: update.message } : {}),
		...(update.callback_query ? { callback: update.callback_query } : {}),
	};
}

export class TelegramUpdateHandler {
	constructor(
		private readonly repository: Repository,
		private readonly telegram: TelegramMessenger,
		private readonly ai: AiInterpreter,
		private readonly options: HandlerOptions,
	) {}

	async handle(update: TelegramUpdate): Promise<void> {
		const { message, callback } = getContext(update);

		if (callback) {
			await this.handleCallback(update.update_id, callback);
			return;
		}

		if (!message?.from) {
			return;
		}

		const user = await this.repository.upsertUser(message.from);
		const text = message.text?.trim();
		if (!text) {
			await this.telegram.sendMessage(message.chat.id, "Пожалуйста, отправьте вопрос текстом.");
			return;
		}

		if (text.startsWith("/start")) {
			await this.showPersonas(message.chat.id, user, true);
			return;
		}

		if (text.startsWith("/new")) {
			await this.showPersonas(message.chat.id, user, false);
			return;
		}

		if (text.startsWith("/history")) {
			await this.showHistory(message.chat.id, user);
			return;
		}

		if (text.startsWith("/delete_history")) {
			await this.repository.deleteHistory(user.id);
			await this.telegram.sendMessage(
				message.chat.id,
				"История удалена. Использованный бесплатный лимит при этом не восстанавливается.",
			);
			return;
		}

		if (text.startsWith("/help")) {
			await this.telegram.sendMessage(
				message.chat.id,
				"Команды:\n/start — начать\n/new — новый расклад\n/history — история\n/delete_history — удалить историю\n/help — помощь",
			);
			return;
		}

		await this.handleQuestion(update.update_id, message, user, text);
	}

	private async handleCallback(updateId: number, callback: TelegramCallbackQuery): Promise<void> {
		await this.telegram.answerCallbackQuery(callback.id);
		const chatId = callback.message?.chat.id;
		if (!chatId || !callback.data) {
			return;
		}

		const user = await this.repository.upsertUser(callback.from);

		if (callback.data === "action:new") {
			await this.showPersonas(chatId, user, false);
			return;
		}

		if (callback.data === "action:history") {
			await this.showHistory(chatId, user);
			return;
		}

		if (callback.data.startsWith("persona:")) {
			const persona = getPersona(callback.data.slice("persona:".length));
			if (!persona) {
				await this.telegram.sendMessage(chatId, "Консультантка не найдена.");
				return;
			}

			await this.repository.selectPersona(user.id, persona.id);
			await this.telegram.sendMessage(
				chatId,
				`Вы выбрали ${persona.name}: ${persona.shortBio}.\n\nТеперь выберите тему.`,
				TOPIC_KEYBOARD,
			);
			return;
		}

		if (callback.data.startsWith("topic:")) {
			const currentUser = await this.repository.getUserByTelegramId(String(callback.from.id));
			const persona = getPersona(currentUser?.selected_persona_id ?? null);
			const topic = getTopic(callback.data.slice("topic:".length));
			if (!currentUser || !persona || !topic) {
				await this.telegram.sendMessage(chatId, "Сначала выберите консультантку через /new.");
				return;
			}

			await this.repository.selectTopic(currentUser.id, topic.id);
			await this.telegram.sendMessage(
				chatId,
				`Тема: ${topic.label}.\nОпишите ситуацию и задайте один вопрос (от 10 до 1000 символов).`,
			);
			return;
		}

		console.log(
			JSON.stringify({
				message: "ignored unknown callback",
				updateId,
			}),
		);
	}

	private async showPersonas(
		chatId: number,
		user: UserRecord,
		includeIntro: boolean,
	): Promise<void> {
		const telegramId = user.telegram_id;
		const usage = await this.repository.getUsage(user.id);
		if (!isWhitelisted(telegramId, this.options) && usage >= this.options.freeReadingLimit) {
			await this.telegram.sendMessage(
				chatId,
				"Бесплатный лимит исчерпан. В первой версии платежей нет, поэтому новые расклады пока недоступны. Историю можно открыть командой /history.",
			);
			return;
		}

		await this.repository.resetConversation(user.id);
		await this.telegram.sendMessage(
			chatId,
			includeIntro ? `${INTRO}\n\nВыберите консультантку:` : "Выберите консультантку:",
			PERSONA_KEYBOARD,
		);
	}

	private async showHistory(chatId: number, user: UserRecord): Promise<void> {
		const history = await this.repository.listHistory(user.id);
		if (history.length === 0) {
			await this.telegram.sendMessage(chatId, "История раскладов пока пуста.");
			return;
		}

		const text = history
			.map((reading, index) => {
				const persona = getPersona(reading.persona_id);
				const topic = getTopic(reading.topic);
				const date = reading.created_at.slice(0, 10);
				return `${index + 1}. ${date} · ${persona?.name ?? reading.persona_id} · ${topic?.label ?? reading.topic}\n${reading.question}`;
			})
			.join("\n\n");

		await this.telegram.sendMessage(
			chatId,
			`📚 Последние расклады\n\n${text}\n\nУдалить историю: /delete_history`,
		);
	}

	private async handleQuestion(
		updateId: number,
		message: TelegramMessage,
		user: UserRecord,
		question: string,
	): Promise<void> {
		if (user.state !== "awaiting_question") {
			await this.telegram.sendMessage(
				message.chat.id,
				"Начните новый расклад командой /new и выберите консультантку и тему.",
			);
			return;
		}

		if (question.length < 10 || question.length > 1_000) {
			await this.telegram.sendMessage(
				message.chat.id,
				"Вопрос должен содержать от 10 до 1000 символов. Попробуйте сформулировать его чуть подробнее.",
			);
			return;
		}

		const persona = getPersona(user.selected_persona_id);
		const topic = getTopic(user.selected_topic);
		if (!persona || !topic) {
			await this.telegram.sendMessage(
				message.chat.id,
				"Не удалось восстановить выбор. Начните заново через /new.",
			);
			return;
		}

		await this.generateReading(updateId, message.chat.id, user, persona, topic, question);
	}

	private async generateReading(
		updateId: number,
		chatId: number,
		user: UserRecord,
		persona: Persona,
		topic: Topic,
		question: string,
	): Promise<void> {
		const metered = !isWhitelisted(user.telegram_id, this.options);
		let reading = await this.repository.getReadingByUpdate(updateId);

		if (reading?.status === "completed" && reading.result_text) {
			await this.sendCompletedReading(chatId, reading);
			return;
		}

		let cards: DrawnCard[];
		if (reading?.status === "generating") {
			cards = deserializeCards(reading.cards_json);
		} else {
			if (
				metered &&
				!(await this.repository.reserveFreeReading(user.id, this.options.freeReadingLimit))
			) {
				await this.telegram.sendMessage(
					chatId,
					"Бесплатный лимит исчерпан. Новые расклады в первой версии пока недоступны.",
				);
				return;
			}

			cards = drawThreeCards();
			if (reading?.status === "failed") {
				await this.repository.restartReading(reading.id, cards);
				reading = { ...reading, cards_json: JSON.stringify(cards), status: "generating" };
			} else {
				try {
					reading = await this.repository.createReading({
						userId: user.id,
						personaId: persona.id,
						topic: topic.id,
						question,
						cards,
						telegramUpdateId: updateId,
					});
				} catch (error) {
					if (metered) {
						await this.repository.releaseFreeReading(user.id);
					}
					throw error;
				}
			}
		}

		await this.telegram.sendMessage(
			chatId,
			`${persona.name} изучает вопрос и связывает значения карт…`,
		);

		let interpretation: string;
		try {
			interpretation = await this.ai.interpret({
				question,
				persona,
				topic,
				cards,
			});
		} catch (error) {
			await this.repository.failReading(reading.id);
			if (metered) {
				await this.repository.releaseFreeReading(user.id);
			}
			console.error(
				JSON.stringify({
					message: "AI interpretation failed",
					updateId,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
			await this.telegram.sendMessage(
				chatId,
				"Сейчас не удалось подготовить интерпретацию. Бесплатная попытка сохранена — отправьте вопрос ещё раз.",
			);
			return;
		}

		await this.repository.completeReading(reading.id, interpretation);
		await this.repository.resetConversation(user.id);
		await this.telegram.sendMessage(chatId, formatCards(cards));
		const chunks = splitTelegramText(interpretation);
		for (const [index, chunk] of chunks.entries()) {
			await this.telegram.sendMessage(
				chatId,
				chunk,
				index === chunks.length - 1 ? AFTER_READING_KEYBOARD : undefined,
			);
		}
	}

	private async sendCompletedReading(chatId: number, reading: ReadingRecord): Promise<void> {
		await this.telegram.sendMessage(chatId, formatCards(deserializeCards(reading.cards_json)));
		const chunks = splitTelegramText(reading.result_text ?? "");
		for (const [index, chunk] of chunks.entries()) {
			await this.telegram.sendMessage(
				chatId,
				chunk,
				index === chunks.length - 1 ? AFTER_READING_KEYBOARD : undefined,
			);
		}
	}
}
