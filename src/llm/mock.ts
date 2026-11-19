import type { AiInterpreter, InterpretationInput } from "./types";

export class MockAiInterpreter implements AiInterpreter {
	async interpret(input: InterpretationInput): Promise<string> {
		const cardParagraphs = input.cards
			.map(
				(drawn, index) =>
					`${index + 1}. ${drawn.card.name}. В контексте вопроса карта подчёркивает: ${drawn.meaning}.`,
			)
			.join("\n\n");

		return [
			`${input.persona.name} рассматривает ваш вопрос по теме «${input.topic.label.replace(/^\S+\s/, "")}».`,
			cardParagraphs,
			"Общий смысл: карты предлагают не искать гарантированный прогноз, а заметить текущую динамику, отделить факты от ожиданий и выбрать один бережный шаг, который зависит от вас.",
			"Это символическая AI-интерпретация для самоанализа, а не предсказание или профессиональная рекомендация.",
		].join("\n\n");
	}
}
