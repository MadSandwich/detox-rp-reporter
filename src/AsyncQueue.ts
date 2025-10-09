export default class AsyncQueue<T> {
	private queue: Promise<T>[]

	constructor() {
		this.queue = []
	}

	public enqueue(promise: Promise<T>): void {
		this.queue.push(promise)
	}

	public catchAndLogError(promise: Promise<T>, customMessage?: string): void {
		promise.catch(error => {
			console.error(customMessage || 'Error in AsyncQueue:', error)
		})
	}

	public async process(): Promise<T[]> {
		return Promise.all(this.queue)
	}
}
