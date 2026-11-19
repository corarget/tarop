import type { Persona } from "../personas/catalog";
import type { DrawnCard } from "../tarot/draw";
import type { Topic } from "../topics";

export interface InterpretationInput {
	question: string;
	persona: Persona;
	topic: Topic;
	cards: readonly DrawnCard[];
}

export interface AiInterpreter {
	interpret(input: InterpretationInput): Promise<string>;
}
