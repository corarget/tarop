import type { PersonaId } from "../personas/catalog";
import type { DrawnCard } from "../tarot/draw";
import type { TopicId } from "../topics";
import type { TelegramUser } from "../telegram/types";

export type ConversationState = "selecting_persona" | "selecting_topic" | "awaiting_question";

export interface UserRecord {
	id: string;
	telegram_id: string;
	first_name: string;
	selected_persona_id: string | null;
	selected_topic: string | null;
	state: ConversationState;
}

export interface ReadingRecord {
	id: string;
	user_id: string;
	persona_id: PersonaId;
	topic: TopicId;
	question: string;
	cards_json: string;
	result_text: string | null;
	status: "generating" | "completed" | "failed";
	created_at: string;
}

export interface HistoryRecord {
	id: string;
	persona_id: PersonaId;
	topic: TopicId;
	question: string;
	result_text: string;
	created_at: string;
}

function wasChanged(result: D1Result): boolean {
	return result.meta.changes > 0;
}

export class Repository {
	constructor(private readonly database: D1Database) {}

	async claimUpdate(updateId: number): Promise<boolean> {
		const inserted = await this.database
			.prepare(
				`INSERT INTO processed_updates (update_id, status)
				 VALUES (?, 'processing')
				 ON CONFLICT(update_id) DO NOTHING`,
			)
			.bind(updateId)
			.run();

		if (wasChanged(inserted)) {
			return true;
		}

		const reclaimed = await this.database
			.prepare(
				`UPDATE processed_updates
				 SET status = 'processing', attempts = attempts + 1,
				     error_message = NULL, updated_at = CURRENT_TIMESTAMP
				 WHERE update_id = ? AND status = 'failed'`,
			)
			.bind(updateId)
			.run();

		return wasChanged(reclaimed);
	}

	async finishUpdate(updateId: number): Promise<void> {
		await this.database
			.prepare(
				`UPDATE processed_updates
				 SET status = 'done', updated_at = CURRENT_TIMESTAMP
				 WHERE update_id = ?`,
			)
			.bind(updateId)
			.run();
	}

	async failUpdate(updateId: number, errorMessage: string): Promise<void> {
		await this.database
			.prepare(
				`UPDATE processed_updates
				 SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
				 WHERE update_id = ?`,
			)
			.bind(errorMessage.slice(0, 500), updateId)
			.run();
	}

	async upsertUser(telegramUser: TelegramUser): Promise<UserRecord> {
		const telegramId = String(telegramUser.id);
		await this.database
			.prepare(
				`INSERT INTO users (
				   id, telegram_id, username, first_name, locale
				 ) VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(telegram_id) DO UPDATE SET
				   username = excluded.username,
				   first_name = excluded.first_name,
				   locale = excluded.locale,
				   updated_at = CURRENT_TIMESTAMP`,
			)
			.bind(
				crypto.randomUUID(),
				telegramId,
				telegramUser.username ?? null,
				telegramUser.first_name,
				telegramUser.language_code ?? null,
			)
			.run();

		const user = await this.getUserByTelegramId(telegramId);
		if (!user) {
			throw new Error("Unable to load user after upsert");
		}

		await this.database
			.prepare(
				`INSERT INTO usage_limits (user_id)
				 VALUES (?) ON CONFLICT(user_id) DO NOTHING`,
			)
			.bind(user.id)
			.run();

		return user;
	}

	async getUserByTelegramId(telegramId: string): Promise<UserRecord | null> {
		return this.database
			.prepare(
				`SELECT id, telegram_id, first_name, selected_persona_id,
				        selected_topic, state
				 FROM users WHERE telegram_id = ?`,
			)
			.bind(telegramId)
			.first<UserRecord>();
	}

	async selectPersona(userId: string, personaId: PersonaId): Promise<void> {
		await this.database
			.prepare(
				`UPDATE users
				 SET selected_persona_id = ?, selected_topic = NULL,
				     state = 'selecting_topic', updated_at = CURRENT_TIMESTAMP
				 WHERE id = ?`,
			)
			.bind(personaId, userId)
			.run();
	}

	async selectTopic(userId: string, topicId: TopicId): Promise<void> {
		await this.database
			.prepare(
				`UPDATE users
				 SET selected_topic = ?, state = 'awaiting_question',
				     updated_at = CURRENT_TIMESTAMP
				 WHERE id = ?`,
			)
			.bind(topicId, userId)
			.run();
	}

	async resetConversation(userId: string): Promise<void> {
		await this.database
			.prepare(
				`UPDATE users
				 SET selected_persona_id = NULL, selected_topic = NULL,
				     state = 'selecting_persona', updated_at = CURRENT_TIMESTAMP
				 WHERE id = ?`,
			)
			.bind(userId)
			.run();
	}

	async getUsage(userId: string): Promise<number> {
		const row = await this.database
			.prepare("SELECT free_readings_used FROM usage_limits WHERE user_id = ?")
			.bind(userId)
			.first<{ free_readings_used: number }>();
		return row?.free_readings_used ?? 0;
	}

	async reserveFreeReading(userId: string, limit: number): Promise<boolean> {
		const result = await this.database
			.prepare(
				`UPDATE usage_limits
				 SET free_readings_used = free_readings_used + 1,
				     updated_at = CURRENT_TIMESTAMP
				 WHERE user_id = ? AND free_readings_used < ?`,
			)
			.bind(userId, limit)
			.run();
		return wasChanged(result);
	}

	async releaseFreeReading(userId: string): Promise<void> {
		await this.database
			.prepare(
				`UPDATE usage_limits
				 SET free_readings_used = MAX(free_readings_used - 1, 0),
				     updated_at = CURRENT_TIMESTAMP
				 WHERE user_id = ?`,
			)
			.bind(userId)
			.run();
	}

	async createReading(input: {
		userId: string;
		personaId: PersonaId;
		topic: TopicId;
		question: string;
		cards: readonly DrawnCard[];
		telegramUpdateId: number;
	}): Promise<ReadingRecord> {
		const id = crypto.randomUUID();
		await this.database.batch([
			this.database
				.prepare(
					`INSERT INTO readings (
					   id, user_id, persona_id, topic, question, cards_json,
					   status, telegram_update_id
					 ) VALUES (?, ?, ?, ?, ?, ?, 'generating', ?)`,
				)
				.bind(
					id,
					input.userId,
					input.personaId,
					input.topic,
					input.question,
					JSON.stringify(input.cards),
					input.telegramUpdateId,
				),
			this.database
				.prepare(
					`INSERT INTO messages (id, reading_id, role, content)
					 VALUES (?, ?, 'user', ?)`,
				)
				.bind(crypto.randomUUID(), id, input.question),
		]);

		const reading = await this.getReadingByUpdate(input.telegramUpdateId);
		if (!reading) {
			throw new Error("Unable to load reading after creation");
		}
		return reading;
	}

	async restartReading(readingId: string, cards: readonly DrawnCard[]): Promise<void> {
		await this.database
			.prepare(
				`UPDATE readings
				 SET cards_json = ?, result_text = NULL, status = 'generating',
				     completed_at = NULL
				 WHERE id = ?`,
			)
			.bind(JSON.stringify(cards), readingId)
			.run();
	}

	async getReadingByUpdate(updateId: number): Promise<ReadingRecord | null> {
		return this.database
			.prepare(
				`SELECT id, user_id, persona_id, topic, question, cards_json,
				        result_text, status, created_at
				 FROM readings WHERE telegram_update_id = ?`,
			)
			.bind(updateId)
			.first<ReadingRecord>();
	}

	async completeReading(readingId: string, resultText: string): Promise<void> {
		await this.database.batch([
			this.database
				.prepare(
					`UPDATE readings
					 SET result_text = ?, status = 'completed',
					     completed_at = CURRENT_TIMESTAMP
					 WHERE id = ?`,
				)
				.bind(resultText, readingId),
			this.database
				.prepare(
					`INSERT INTO messages (id, reading_id, role, content)
					 VALUES (?, ?, 'assistant', ?)`,
				)
				.bind(crypto.randomUUID(), readingId, resultText),
		]);
	}

	async failReading(readingId: string): Promise<void> {
		await this.database
			.prepare("UPDATE readings SET status = 'failed' WHERE id = ?")
			.bind(readingId)
			.run();
	}

	async listHistory(userId: string, limit = 5): Promise<HistoryRecord[]> {
		const result = await this.database
			.prepare(
				`SELECT id, persona_id, topic, question, result_text, created_at
				 FROM readings
				 WHERE user_id = ? AND status = 'completed'
				 ORDER BY created_at DESC LIMIT ?`,
			)
			.bind(userId, limit)
			.all<HistoryRecord>();
		return result.results;
	}

	async deleteHistory(userId: string): Promise<void> {
		await this.database.prepare("DELETE FROM readings WHERE user_id = ?").bind(userId).run();
	}
}
