export type TopicId = "relationships" | "work" | "choice" | "self";

export interface Topic {
	id: TopicId;
	label: string;
}

export const TOPICS: readonly Topic[] = [
	{ id: "relationships", label: "❤️ Отношения" },
	{ id: "work", label: "💼 Работа" },
	{ id: "choice", label: "🧭 Решение" },
	{ id: "self", label: "✨ Свой вопрос" },
] as const;

export function getTopic(id: string | null): Topic | undefined {
	return TOPICS.find((topic) => topic.id === id);
}
