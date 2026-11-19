import {
	Repository,
	type ReadingDraft,
	type ReadingRecord,
	type UserRecord,
} from "../db/repository";
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
	"🔮 Tarop",
	"Расскажите, с чем пришли. Виртуальная консультантка уточнит одну деталь, а вы выберете, с какой карты начать.",
	"Расклад — повод обдумать ситуацию.",
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

const CONTEXT_QUESTIONS: Record<Topic["id"], string> = {
	relationships: "Что между вами произошло в последнее время, что заставило вас об этом спросить?",
	work: "Что уже известно о ситуации на работе и в чём сейчас главная неопределённость?",
	choice: "Между какими вариантами вы выбираете и что больше всего смущает?",
	self: "Что уже произошло и какую деталь мне важно знать, чтобы точнее ответить?",
};

const ART_URL =
	"https://raw.githubusercontent.com/metabismuth/tarot-json/e6414a098acc87831a8953bca7576b033b2fda54/cards";
const POSITIONS = ["Главное", "Что мешает", "Следующий шаг"];

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

function getDraft(user: UserRecord): ReadingDraft | null {
	return user.draft_json ? (JSON.parse(user.draft_json) as ReadingDraft) : null;
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
			if (user.state === "reading") {
				await this.telegram.sendMessage(
					message.chat.id,
					"Дождитесь конца расклада и повторите команду.",
				);
				return;
			}
			await this.repository.deleteHistory(user.id);
			await this.repository.resetConversation(user.id);
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
		const draft = getDraft(user);

		if (callback.data.startsWith("open:")) {
			const [, draftId, index] = callback.data.split(":");
			const completed = await this.repository.getReadingByUpdate(updateId);
			if (completed?.status === "completed" && completed.result_text) {
				await this.sendCompletedReading(chatId, completed);
				return;
			}
			const chosenCard = draft?.cards?.[Number(index)];
			const persona = getPersona(user.selected_persona_id);
			const topic = getTopic(user.selected_topic);
			if (!draft || draft.id !== draftId || !chosenCard || !draft.cards || !persona || !topic) {
				return;
			}
			if (!(await this.repository.claimDraft(user.id, draft.id, updateId))) {
				return;
			}
			if (callback.message) {
				await this.telegram.removeKeyboard(chatId, callback.message.message_id).catch(() => {});
			}
			const cards = [chosenCard, ...draft.cards.filter((card) => card !== chosenCard)];
			await this.generateReading(updateId, chatId, user, persona, topic, draft, cards);
			return;
		}

		if (callback.data.startsWith("skip:") && draft?.id === callback.data.slice(5)) {
			await this.prepareSpread(updateId, chatId, user, draft);
			return;
		}

		if (user.state === "reading" && callback.data !== "action:history") {
			return;
		}

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
				"Что вы хотите понять? Напишите вопрос так, как задали бы его в переписке.",
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
		if (user.state === "reading") {
			await this.telegram.sendMessage(
				chatId,
				"Заканчиваю текущий расклад. Новый можно начать после ответа.",
			);
			return;
		}
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
		const draft = getDraft(user);
		if (user.state === "awaiting_context" && draft) {
			if (draft.questionUpdateId === updateId) {
				const persona = getPersona(user.selected_persona_id);
				const topic = getTopic(user.selected_topic);
				if (persona && topic) {
					await this.askForContext(message.chat.id, draft, persona, topic);
				}
			} else if (question.length <= 1_000) {
				await this.prepareSpread(updateId, message.chat.id, user, draft, question);
			} else {
				await this.telegram.sendMessage(message.chat.id, "Ответьте чуть короче, до 1000 символов.");
			}
			return;
		}
		if (user.state === "awaiting_card" && draft) {
			if (draft.contextUpdateId === updateId) {
				await this.showSpread(message.chat.id, draft.id);
			} else {
				await this.telegram.sendMessage(
					message.chat.id,
					"Ваш вопрос уже у меня. Выберите карту под раскладом.",
				);
			}
			return;
		}
		if (user.state === "reading") {
			await this.telegram.sendMessage(message.chat.id, "Расклад уже готовится.");
			return;
		}
		if (user.state !== "awaiting_question") {
			await this.telegram.sendMessage(
				message.chat.id,
				"Начните новый расклад командой /new и выберите консультантку и тему.",
			);
			return;
		}

		if (question.length > 1_000) {
			await this.telegram.sendMessage(message.chat.id, "Сократите вопрос до 1000 символов.");
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

		const newDraft = { id: crypto.randomUUID(), question, questionUpdateId: updateId };
		if (await this.repository.createDraft(user, newDraft)) {
			await this.askForContext(message.chat.id, newDraft, persona, topic);
		}
	}

	private async askForContext(
		chatId: number,
		draft: ReadingDraft,
		persona: Persona,
		topic: Topic,
	): Promise<void> {
		const generated = await this.ai
			.clarify?.({ question: draft.question, persona, topic })
			.catch(() => "");
		await this.telegram.sendMessage(chatId, generated || CONTEXT_QUESTIONS[topic.id], {
			inline_keyboard: [[{ text: "Продолжить без уточнения", callback_data: `skip:${draft.id}` }]],
		});
	}

	private async prepareSpread(
		updateId: number,
		chatId: number,
		user: UserRecord,
		draft: ReadingDraft,
		context?: string,
	): Promise<void> {
		if (draft.contextUpdateId === updateId && user.state === "awaiting_card") {
			await this.showSpread(chatId, draft.id);
			return;
		}
		const spread = {
			...draft,
			...(context ? { context } : {}),
			contextUpdateId: updateId,
			cards: drawThreeCards(),
		};
		if (await this.repository.prepareDraft(user.id, spread)) {
			await this.showSpread(chatId, draft.id);
		}
	}

	private async showSpread(chatId: number, draftId: string): Promise<void> {
		const caption =
			"Выберите 1, 2 или 3. Эта карта будет главной. Две остальные покажут, что мешает и с чего можно начать.";
		const keyboard = {
			inline_keyboard: [
				[0, 1, 2].map((index) => ({
					text: String(index + 1),
					callback_data: `open:${draftId}:${index}`,
				})),
			],
		};
		try {
			await this.telegram.sendSpreadCover(chatId, caption, keyboard);
		} catch {
			await this.telegram.sendMessage(chatId, caption, keyboard);
		}
	}

	private async showCards(chatId: number, cards: readonly DrawnCard[]): Promise<void> {
		try {
			await this.telegram.sendCardAlbum(
				chatId,
				cards.map((card, index) => ({
					url: `${ART_URL}/m${String(card.card.id).padStart(2, "0")}.jpg`,
					caption: `${POSITIONS[index]} · ${card.card.name}${card.orientation === "reversed" ? " (перевёрнутая)" : ""}`,
				})),
			);
		} catch {
			await this.telegram.sendMessage(chatId, formatCards(cards));
		}
	}

	private async generateReading(
		updateId: number,
		chatId: number,
		user: UserRecord,
		persona: Persona,
		topic: Topic,
		draft: ReadingDraft,
		chosenCards: readonly DrawnCard[],
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
				await this.repository.resetConversation(user.id);
				return;
			}

			cards = [...chosenCards];
			if (reading?.status === "failed") {
				await this.repository.restartReading(reading.id, cards);
				reading = { ...reading, cards_json: JSON.stringify(cards), status: "generating" };
			} else {
				try {
					reading = await this.repository.createReading({
						userId: user.id,
						personaId: persona.id,
						topic: topic.id,
						question: draft.question,
						...(draft.context ? { context: draft.context } : {}),
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

		await this.showCards(chatId, cards);
		let interpretation: string;
		try {
			interpretation = await this.ai.interpret({
				question: draft.question,
				...(draft.context ? { context: draft.context } : {}),
				persona,
				topic,
				cards,
			});
		} catch (error) {
			await this.repository.failReading(reading.id);
			if (metered) {
				await this.repository.releaseFreeReading(user.id);
			}
			await this.repository.returnDraft(user.id, updateId);
			console.error(
				JSON.stringify({
					message: "AI interpretation failed",
					updateId,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
			await this.telegram.sendMessage(
				chatId,
				"Ответ не загрузился. Попытка сохранена, можно открыть те же карты ещё раз.",
			);
			await this.showSpread(chatId, draft.id);
			return;
		}

		await this.repository.completeReading(reading.id, interpretation);
		await this.repository.resetConversation(user.id);
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
		await this.showCards(chatId, deserializeCards(reading.cards_json));
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
