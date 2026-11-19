import type { AiInterpreter, InterpretationInput } from "./types";

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | null;
		};
	}>;
}

function createSystemPrompt(input: InterpretationInput): string {
	return [
		`Ты — виртуальная таро-консультантка ${input.persona.name}.`,
		input.persona.stylePrompt,
		"Пиши по-русски. Таро используется как инструмент самоанализа, а не как достоверное предсказание.",
		"Не утверждай факты о будущем, чужих мыслях, здоровье, праве или финансах. Не усиливай тревогу и не обещай результат.",
		"Структура ответа: короткое вступление; разбор каждой из трёх карт; общий смысл; один аккуратный практический вывод.",
		"Используй только переданные карты и значения. Не добавляй другие карты. Максимум 2800 символов.",
	].join(" ");
}

function createUserPrompt(input: InterpretationInput): string {
	const cards = input.cards
		.map(
			(drawn, index) => `${index + 1}. ${drawn.card.name} (${drawn.orientation}): ${drawn.meaning}`,
		)
		.join("\n");

	return `Тема: ${input.topic.label}\nВопрос: ${input.question}\n\nКарты:\n${cards}`;
}

export class OpenAiCompatibleInterpreter implements AiInterpreter {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
		private readonly model: string,
	) {}

	async interpret(input: InterpretationInput): Promise<string> {
		const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: this.model,
				temperature: 0.8,
				max_tokens: 900,
				messages: [
					{ role: "system", content: createSystemPrompt(input) },
					{ role: "user", content: createUserPrompt(input) },
				],
			}),
			signal: AbortSignal.timeout(25_000),
		});

		if (!response.ok) {
			throw new Error(`AI provider returned HTTP ${response.status}`);
		}

		const payload = await response.json<ChatCompletionResponse>();
		const content = payload.choices?.[0]?.message?.content?.trim();
		if (!content) {
			throw new Error("AI provider returned an empty interpretation");
		}

		return content;
	}
}
