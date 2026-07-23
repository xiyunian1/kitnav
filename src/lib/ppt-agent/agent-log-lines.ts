export class PptAgentLogLineBuffer {
	private pending = "";
	private droppingOversizedLine = false;

	constructor(private readonly maxLineChars: number) {}

	push(chunk: string): { lines: string[]; oversized: boolean } {
		let text = chunk;
		let oversized = false;
		if (this.droppingOversizedLine) {
			const newline = text.search(/\r?\n/);
			if (newline < 0) return { lines: [], oversized: false };
			const newlineLength = text[newline] === "\r" ? 2 : 1;
			text = text.slice(newline + newlineLength);
			this.droppingOversizedLine = false;
		}

		const parts = (this.pending + text).split(/\r?\n/);
		this.pending = parts.pop() || "";
		const lines = parts.filter((line) => {
			if (line.length <= this.maxLineChars) return true;
			oversized = true;
			return false;
		});
		if (this.pending.length > this.maxLineChars) {
			this.pending = "";
			this.droppingOversizedLine = true;
			oversized = true;
		}
		return { lines, oversized };
	}

	flush() {
		if (this.droppingOversizedLine || !this.pending) {
			this.pending = "";
			this.droppingOversizedLine = false;
			return [];
		}
		const line = this.pending;
		this.pending = "";
		return line.length <= this.maxLineChars ? [line] : [];
	}
}

export class PptPendingLogWrites {
	private writes = new Set<Promise<unknown>>();

	add(write: Promise<unknown>) {
		this.writes.add(write);
		void write.then(
			() => this.writes.delete(write),
			() => this.writes.delete(write),
		);
	}

	async drain() {
		while (this.writes.size > 0) {
			await Promise.allSettled([...this.writes]);
		}
	}
}
