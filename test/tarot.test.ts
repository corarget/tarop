import { describe, expect, it } from "vite-plus/test";
import { MAJOR_ARCANA } from "../src/tarot/cards";
import { drawThreeCards } from "../src/tarot/draw";
import { splitTelegramText } from "../src/text";

describe("tarot deck", () => {
	it("contains the 22 Major Arcana", () => {
		expect(MAJOR_ARCANA).toHaveLength(22);
		expect(new Set(MAJOR_ARCANA.map((card) => card.id)).size).toBe(22);
	});

	it("draws three unique cards and fixes their orientation", () => {
		const sequence = [0, 0, 0, 1, 0, 0];
		let cursor = 0;
		const cards = drawThreeCards((upperExclusive) => {
			const next = sequence[cursor] ?? 0;
			cursor += 1;
			return next % upperExclusive;
		});

		expect(cards).toHaveLength(3);
		expect(new Set(cards.map((drawn) => drawn.card.id)).size).toBe(3);
		expect(cards[0]?.orientation).toBe("upright");
		expect(cards[1]?.orientation).toBe("reversed");
		expect(cards[2]?.meaning).toBe(cards[2]?.card.upright);
	});
});

describe("Telegram text", () => {
	it("splits long interpretations below the Telegram limit", () => {
		const chunks = splitTelegramText("Абзац\n\n".repeat(1_000));
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.length <= 4_000)).toBe(true);

		const unbrokenChunks = splitTelegramText("а".repeat(9_000));
		expect(unbrokenChunks.map((chunk) => chunk.length)).toEqual([4_000, 4_000, 1_000]);
	});
});
