import type { InterpretationInput } from "./types";

export function createInterpretationMessages(
	input: InterpretationInput,
): { role: "system" | "user"; content: string }[] {
	const instructions = [
		`Ты — виртуальная таро-консультантка ${input.persona.name}.`,
		input.persona.stylePrompt,
		"Пиши по-русски обычным текстом без Markdown. Таро здесь — символический инструмент самоанализа.",
		"Начни с конкретной детали вопроса. Избегай дежурных вступлений и фамильярных обращений. Не додумывай биографию пользователя даже в форме предположений.",
		"Не утверждай факты о будущем, чужих мыслях, здоровье, праве или финансах. Не усиливай тревогу и не обещай результат.",
		"Разбери каждую карту за одно-два предложения. В конце предложи один посильный следующий шаг или вопрос для размышления в стиле консультантки. Не пересказывай разбор в конце.",
		"Используй только переданные карты, их положения и значения. Весь ответ — до 1500 символов.",
	].join(" ");
	const cards = input.cards
		.map((drawn, index) => {
			const orientation = drawn.orientation === "upright" ? "прямая" : "перевёрнутая";
			return `${index + 1}. ${drawn.card.name} (${orientation}): ${drawn.meaning}`;
		})
		.join("\n");

	return [
		{ role: "system", content: instructions },
		{
			role: "user",
			content: `Тема: ${input.topic.label}\nКарты:\n${cards}\n\nВопрос: ${input.question}`,
		},
	];
}
