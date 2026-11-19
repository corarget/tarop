import { createInterpretationMessages } from "./prompt";
import type { AiInterpreter, InterpretationInput } from "./types";

const MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

export class WorkersAiInterpreter implements AiInterpreter {
	constructor(private readonly ai: Pick<Ai, "run">) {}

	async interpret(input: InterpretationInput): Promise<string> {
		const result = await this.ai.run(
			MODEL,
			{ messages: createInterpretationMessages(input), temperature: 0.6, max_tokens: 650 },
			{ signal: AbortSignal.timeout(25_000) },
		);
		const content = result.response?.trim();
		if (!content) {
			throw new Error("Workers AI returned an empty interpretation");
		}
		return content;
	}
}
