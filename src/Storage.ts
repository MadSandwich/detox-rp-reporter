export default class Storage {
	private storage: { [key: string]: unknown }

	constructor() {
		this.storage = {}
	}

	getItem<T = unknown>(key: string): T {
		return this.storage[key] as T
	}

	getAllKeys(): string[] {
		return Object.keys(this.storage)
	}

	setItem(key: string, value: unknown): void {
		this.storage[key] = value
	}

	removeItem(key: string): void {
		delete this.storage[key]
	}

	clear(): void {
		this.storage = {}
	}
}
