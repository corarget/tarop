const TELEGRAM_MESSAGE_LIMIT = 4_000;

export function splitTelegramText(text: string): string[] {
	if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
		return [text];
	}

	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
		const candidate = remaining.slice(0, TELEGRAM_MESSAGE_LIMIT);
		const paragraphBreak = candidate.lastIndexOf("\n\n");
		const lineBreak = candidate.lastIndexOf("\n");
		const preferredBreak = Math.max(paragraphBreak, lineBreak);
		const splitAt = preferredBreak > 0 ? preferredBreak : TELEGRAM_MESSAGE_LIMIT;
		chunks.push(remaining.slice(0, splitAt).trim());
		remaining = remaining.slice(splitAt).trim();
	}

	if (remaining) {
		chunks.push(remaining);
	}

	return chunks;
}
