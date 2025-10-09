declare module '@reportportal/client-javascript' {
	export interface Attribute {
		value: string
		key?: string
		system?: boolean
	}

	export interface ClientConfig {
		apiKey: string
		endpoint: string
		launch: string
		project: string

		headers?: Record<string, string>
		debug?: boolean
		isLaunchMergeRequired?: boolean
		launchUuidPrint?: boolean

		launchUuidPrintOutput?: string | ((param: string) => void)
		restClientConfig?: Record<string, unknown>

		attributes?: Attribute[]
		mode?: string
		description?: string
		skippedIssue?: boolean
	}

	export type AgentParams = {
		name: string
		version: string
	}

	export type LaunchDataRQ = {
		id?: string
		description?: string
		mode?: string
		name?: string
		startTime?: number
		attributes?: Attribute[]
	}

	export type FinishExecutionRQ = {
		endTime?: number
		status?: string
	}

	export type MergeOptions = {
		extendSuitesDescription?: boolean
		description?: string
		mergeType?: 'BASIC' | 'DEEP'
		name?: string
	}

	export type TestItemDataRQ = {
		description?: string
		name: string
		startTime?: number
		attributes?: Attribute[]
		type?: string
		testCaseId?: string
		codeRef: string
		parameters?: { key: string; value: string }[]
		uniqueId?: string
		retry?: boolean
	}

	export type FinishTestItemRQ = {
		endTime?: number
		issue?: {
			comment?: string
			externalSystemIssues?: Array<{
				submitDate?: number
				submitter?: string
				systemId?: string
				ticketId?: string
				url?: string
			}>
			issueType?: string
		}
		status?: string
	}

	export type FileObj = {
		name: string
		type: string
		content: string
	}

	export type SaveLogRQ = {
		level?: string
		message?: string
		time?: number
	}

	export type ItemObj = {
		promiseStart: Promise<unknown>
		realId: string
		children: string[]
		finishSend: boolean
		promiseFinish: Promise<unknown>
		resolveFinish: (value?: unknown) => void
		rejectFinish: (reason?: unknown) => void
	}

	export type MapType = { [tempId: string]: ItemObj }

	export type TempIdPromise<T = unknown> = {
		tempId: string
		promise: Promise<T>
	}

	export interface RPClientInterface {
		helpers: ClientHelpers

		startLaunch(launchDataRQ: LaunchDataRQ): TempIdPromise
		finishLaunch(launchTempId: string, finishExecutionRQ: FinishExecutionRQ): TempIdPromise
		startTestItem(testItemDataRQ: TestItemDataRQ, launchTempId: string, parentTempId?: string): TempIdPromise
		finishTestItem(itemTempId: string, finishTestItemRQ: FinishTestItemRQ): TempIdPromise
		sendLog(itemTempId: string, saveLogRQ: SaveLogRQ, fileObj?: FileObj): TempIdPromise
	}

	interface RPClientConstructor {
		new (options: Partial<ClientConfig>, agentParams?: AgentParams): RPClientInterface
	}

	const RPClient: RPClientConstructor
	export = RPClient
}
