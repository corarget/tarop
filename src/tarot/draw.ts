import { MAJOR_ARCANA, type TarotCard } from "./cards";

export interface DrawnCard {
	card: TarotCard;
	orientation: "upright" | "reversed";
	meaning: string;
}

export type RandomIndex = (upperExclusive: number) => number;

export function secureRandomIndex(upperExclusive: number): number {
	if (!Number.isInteger(upperExclusive) || upperExclusive <= 0) {
		throw new RangeError("upperExclusive must be a positive integer");
	}

	const rangeSize = 0x1_0000_0000;
	const acceptedCeiling = rangeSize - (rangeSize % upperExclusive);
	const buffer = new Uint32Array(1);

	do {
		crypto.getRandomValues(buffer);
	} while ((buffer[0] ?? rangeSize) >= acceptedCeiling);

	return (buffer[0] ?? 0) % upperExclusive;
}

export function drawThreeCards(randomIndex: RandomIndex = secureRandomIndex): DrawnCard[] {
	const available = [...MAJOR_ARCANA];
	const drawn: DrawnCard[] = [];

	for (let position = 0; position < 3; position += 1) {
		const cardIndex = randomIndex(available.length);
		const [card] = available.splice(cardIndex, 1);
		if (!card) {
			throw new Error("Unable to draw a tarot card");
		}

		const orientation = randomIndex(2) === 0 ? "upright" : "reversed";
		drawn.push({
			card,
			orientation,
			meaning: orientation === "upright" ? card.upright : card.reversed,
		});
	}

	return drawn;
}

export function formatCards(cards: readonly DrawnCard[]): string {
	const lines = cards.map((drawn, index) => {
		const orientation = drawn.orientation === "upright" ? "прямая" : "перевёрнутая";
		return `${index + 1}. ${drawn.card.name} — ${orientation}\n${drawn.meaning}`;
	});

	return `🃏 Ваши карты\n\n${lines.join("\n\n")}`;
}
