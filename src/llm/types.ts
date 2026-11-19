import type { Persona } from "../personas/catalog";
import type { DrawnCard } from "../tarot/draw";
import type { Topic } from "../topics";

export interface QuestionInput {
	question: string;
	persona: Persona;
	topic: Topic;
}

export interface InterpretationInput extends QuestionInput {
	context?: string;
	cards: readonly DrawnCard[];
}

export interface AiInterpreter {
	clarify?(input: QuestionInput): Promise<string>;
	interpret(input: InterpretationInput): Promise<string>;
}
