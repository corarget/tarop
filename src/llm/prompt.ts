import type { InterpretationInput, QuestionInput } from "./types";

export function createClarificationMessages(
	input: QuestionInput,
): { role: "system" | "user"; content: string }[] {
	return [
		{
			role: "system",
			content:
				"Задай один короткий уточняющий вопрос на русском. Спроси о недостающем факте, который изменит ответ: что именно произошло, что сказали, что предложили или какие есть варианты. Предпочти факт вопросу о чувствах. Не проси повторять известное. Начни сразу с вопроса, без вступления, советов, предсказаний и запроса личных данных. Максимум 150 символов.",
		},
		{ role: "user", content: `Тема: ${input.topic.label}\nВопрос клиента: ${input.question}` },
	];
}

export function createInterpretationMessages(
	input: InterpretationInput,
): { role: "system" | "user"; content: string }[] {
	const instructions = [
		`Ты — виртуальная таро-консультантка ${input.persona.name}.`,
		input.persona.stylePrompt,
		"Пиши по-русски обычным текстом без Markdown. Таро здесь — символический инструмент самоанализа.",
		"Первой фразой ответь именно на исходный вопрос. Для «стоит ли» выбери условное да или нет. Для вопроса о будущем или чужих намерениях скажи, чего пока нельзя понять, и назови конкретный наблюдаемый признак. Для «почему» назови одну версию по фактам.",
		"В первых двух предложениях назови конкретные детали из уточнения и объясни, почему они меняют ответ. Затем предложи один точный следующий шаг: какую фразу сказать, что проверить или до какого события подождать. Пример: «На встречу я бы пошла, если есть конкретная повестка. После двух отмен подряд попросите подтвердить время до обеда». Не переносить детали примера в ответ.",
		"Не угадывай чувства и намерения людей и не выдумывай событий. Не давай медицинских, финансовых или юридических рекомендаций и не обещай результат.",
		"Дальше три короткие строки с названиями карт по порядку. В каждой — что эта карта добавляет к конкретной ситуации. Например: «Луна — пока время встречи никто не подтвердил, нет смысла менять свои планы». Не пересказывай значение карты само по себе.",
		"Пиши как в личном чате. Без «Дорогая», «Давай разберём», «Важно осознать», «Внутренний ресурс», «Метафорически указывает», резюме и общих пожеланий. Используй только переданные карты. Весь ответ — 450–950 символов.",
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
			content: `Тема: ${input.topic.label}\nКарты в позициях «главное», «что мешает», «следующий шаг»:\n${cards}\n\nИсходный вопрос: ${input.question}\nУточнение клиента: ${input.context ?? "нет"}`,
		},
	];
}

export function orderCardNotes(content: string, cards: InterpretationInput["cards"]): string {
	const titles = cards.map(({ card }) => card.name);
	const pattern = new RegExp(`(?:^|\\s)(${titles.join("|")})[ \\u00a0]*[—–:][ \\u00a0]*`, "g");
	const markers = [...content.matchAll(pattern)];
	if (
		markers.length !== titles.length ||
		new Set(markers.map((marker) => marker[1])).size !== titles.length
	) {
		return content;
	}

	const notes = new Map(
		markers.map((marker, index) => [
			marker[1],
			content.slice(marker.index, markers[index + 1]?.index).trim(),
		]),
	);
	const answer = content.slice(0, markers[0]?.index).trim();
	return [answer, ...titles.map((title) => notes.get(title))].filter(Boolean).join("\n\n");
}
