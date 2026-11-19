import { MockAiInterpreter } from "./mock";
import { OpenAiCompatibleInterpreter } from "./openai-compatible";
import type { AiInterpreter } from "./types";
import { WorkersAiInterpreter } from "./workers-ai";

export function createAiInterpreter(env: Env): AiInterpreter {
	const aiMode: string = env.AI_MODE;
	if (aiMode === "mock") {
		return new MockAiInterpreter();
	}

	if (aiMode === "workers-ai") {
		if (!env.AI) {
			throw new Error("AI binding is required in workers-ai mode");
		}
		return new WorkersAiInterpreter(env.AI);
	}

	if (aiMode !== "openai-compatible") {
		throw new Error(`Unsupported AI_MODE: ${aiMode}`);
	}

	if (!env.AI_API_KEY) {
		throw new Error("AI_API_KEY is required in openai-compatible mode");
	}

	return new OpenAiCompatibleInterpreter(env.AI_BASE_URL, env.AI_API_KEY, env.AI_MODEL);
}
