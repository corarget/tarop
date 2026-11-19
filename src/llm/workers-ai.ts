import {
	createClarificationMessages,
	createInterpretationMessages,
	orderCardNotes,
} from "./prompt";
import type { AiInterpreter, InterpretationInput, QuestionInput } from "./types";

const MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

export class WorkersAiInterpreter implements AiInterpreter {
	constructor(private readonly ai: Pick<Ai, "run">) {}

	async clarify(input: QuestionInput): Promise<string> {
		const result = await this.ai.run(
			MODEL,
			{ messages: createClarificationMessages(input), temperature: 0.25, max_tokens: 85 },
			{ signal: AbortSignal.timeout(7_000) },
		);
		const question = result.response?.trim().replace(/^["«]+|["»]+$/g, "");
		return question && question.length <= 180 && /^[^?\n]+\?$/.test(question) ? question : "";
	}

	async interpret(input: InterpretationInput): Promise<string> {
		const result = await this.ai.run(
			MODEL,
			{ messages: createInterpretationMessages(input), temperature: 0.55, max_tokens: 420 },
			{ signal: AbortSignal.timeout(25_000) },
		);
		const content = result.response?.trim();
		if (!content) {
			throw new Error("Workers AI returned an empty interpretation");
		}
		return orderCardNotes(content, input.cards);
	}
}
