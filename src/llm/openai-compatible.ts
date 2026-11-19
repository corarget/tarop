import { createInterpretationMessages } from "./prompt";
import type { AiInterpreter, InterpretationInput } from "./types";

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | null;
		};
	}>;
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
				messages: createInterpretationMessages(input),
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
