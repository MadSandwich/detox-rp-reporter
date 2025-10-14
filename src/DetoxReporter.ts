import fs from 'node:fs'
import path from 'node:path'
import type { Reporter, Test, TestCaseResult, TestResult } from '@jest/reporters'
import type { Circus, Config } from '@jest/types'
import type { ClientConfig, FileObj, RPClientInterface, SaveLogRQ } from '@reportportal/client-javascript'
import RPClient from '@reportportal/client-javascript'
import AsyncQueue from './AsyncQueue'
import generateReplayScript, { type CachedCommand } from './helper/OfflineMod'
import Storage from './Storage'

export const LOG_LEVEL = {
	DEBUG: 'debug',
	ERROR: 'error',
	INFO: 'info',
	TRACE: 'trace',
	WARN: 'warn',
} as const

export const TEST_ITEM_TYPES = {
	STEP: 'STEP',
	SUITE: 'SUITE',
} as const

interface ExtendedClientConfig extends ClientConfig {
	artifactsPath?: string | undefined
	extendTestDescriptionWithLastError: boolean
	saveToFile?: boolean
	cacheFilePath?: string
}

export default class DetoxReporter implements Reporter {
	private readonly reportOptions: ExtendedClientConfig
	private readonly client: RPClientInterface

	private asyncQueue: AsyncQueue<unknown>
	private storage: Storage
	private cachedCommands: CachedCommand[]
	private cacheFilePath: string
	private saveToFile: boolean

	constructor(_globalConfig: Config.GlobalConfig, options: Partial<ExtendedClientConfig>) {
		this.reportOptions = {
			apiKey: process.env.RP_API_KEY ?? options.apiKey ?? '',
			artifactsPath: process.env.DETOX_ARTIFACTS_PATH ?? options.artifactsPath,
			cacheFilePath: options.cacheFilePath ?? './rp-cache.json',
			endpoint: process.env.RP_ENDPOINT ?? options.endpoint ?? '',
			extendTestDescriptionWithLastError: options.extendTestDescriptionWithLastError ?? true,
			launch: process.env.RP_LAUNCH ?? options.launch ?? '',
			project: process.env.RP_PROJECT_NAME ?? options.project ?? 'Detox Agent Reporter',
			saveToFile: options.saveToFile ?? false,
			...(options.attributes && { attributes: options.attributes }),
			...(options.debug !== undefined && { debug: options.debug }),
			...(options.description && { description: process.env.RP_DESCRIPTION ?? options.description }),
			...(options.isLaunchMergeRequired !== undefined && { isLaunchMergeRequired: options.isLaunchMergeRequired }),
			...(options.launchUuidPrint !== undefined && { launchUuidPrint: options.launchUuidPrint }),
			...(options.launchUuidPrintOutput && { launchUuidPrintOutput: options.launchUuidPrintOutput }),
			...(options.mode && { mode: process.env.RP_MODE || options.mode }),
			...(options.restClientConfig && { restClientConfig: options.restClientConfig }),
			...(options.skippedIssue !== undefined && { skippedIssue: options.skippedIssue }),
		}

		this.client = new RPClient(this.reportOptions)
		this.asyncQueue = new AsyncQueue<unknown>()
		this.storage = new Storage()

		// Initialize caching properties
		this.cachedCommands = []
		this.cacheFilePath = this.reportOptions.cacheFilePath ?? './rp-cache.json'
		this.saveToFile = this.reportOptions.saveToFile ?? false
	}

	/**
	 * Called when Jest test run starts
	 *
	 * @description Initiates a new launch in ReportPortal with configured attributes and description.
	 * Sets up the launch ID in storage for subsequent test items to reference.
	 * Always caches commands for replay capability.
	 */
	onRunStart(): void {
		const launchData = {
			attributes: this.reportOptions.attributes ?? [],
			description: this.reportOptions.description ?? '',
			mode: this.reportOptions.mode ?? 'DEFAULT',
			startTime: Date.now(),
		}

		// Always send to ReportPortal and cache for replay capability
		const { tempId, promise } = this.client.startLaunch(launchData)
		this.storage.setItem('launchId', tempId)

		this.cacheCommand({ data: launchData, tempId, type: 'startLaunch' })
		// Send to ReportPortal
		this.asyncQueue.catchAndLogError(promise, 'Error starting launch: ')
		this.asyncQueue.enqueue(promise)
	}

	/**
	 * Saves cached commands to file if saveToFile option is enabled
	 */
	private saveCacheToFile(): void {
		if (!this.saveToFile) {
			return
		}

		try {
			const cacheData = {
				commands: this.cachedCommands,
				reportOptions: this.reportOptions,
				timestamp: Date.now(),
			}

			// Ensure the directory exists before writing the file
			const cacheDir = path.dirname(this.cacheFilePath)
			if (!fs.existsSync(cacheDir)) {
				fs.mkdirSync(cacheDir, { recursive: true })
			}

			fs.writeFileSync(this.cacheFilePath, JSON.stringify(cacheData, null, 2))
			console.log(`Cached ${this.cachedCommands.length} ReportPortal commands to ${this.cacheFilePath}`)

			// Generate replay script when we finish caching
			if (this.cachedCommands.length > 0) {
				const replayScriptPath = this.cacheFilePath.replace('.json', '-replay.js')
				generateReplayScript(this.cacheFilePath, replayScriptPath)
			}
		} catch (error) {
			console.error('Failed to save cache to file:', error)
		}
	}

	/**
	 * Called when a test case starts execution
	 *
	 * @param test - Jest test object containing file path and metadata
	 * @param testCaseStartInfo - Test case start information including ancestor titles and timing
	 * @description Initiates the test suite hierarchy and starts the individual test step in ReportPortal.
	 * Creates necessary parent suites if they don't exist and establishes the test structure.
	 */
	onTestCaseStart(test: Test, testCaseStartInfo: Circus.TestCaseStartInfo): void {
		this.startSuites(testCaseStartInfo.ancestorTitles, test.path, testCaseStartInfo.startedAt ?? Date.now())
		this.startStep(testCaseStartInfo, test.path)
	}

	/**
	 * Called when a test case completes execution
	 *
	 * @param test - Jest test object containing file path and metadata
	 * @param testCaseResult - Test case result information including status and failure details
	 * @description Finishes the test step in ReportPortal with the final status and any error information.
	 * Handles attachment of artifacts if the test failed.
	 */
	onTestCaseResult(test: Test, testCaseResult: TestCaseResult): void {
		this.finishStep(testCaseResult, test.path)
	}

	/**
	 * Called when a test file completes execution
	 *
	 * @param test - Jest test object containing file path and metadata
	 * @param testResult - Complete test file results including all test cases
	 * @description Handles pending/skipped tests and cleans up suite contexts for the completed file.
	 * Ensures all test suites are properly finished in ReportPortal.
	 */
	onTestResult(test: Test, testResult: TestResult): void {
		testResult.testResults.forEach((result: TestCaseResult) => {
			if (result.status === 'pending') {
				const testCaseWithStartTime = {
					ancestorTitles: result.ancestorTitles,
					failureDetails: result.failureDetails,
					failureMessages: result.failureMessages,
					fullName: result.fullName,
					mode: 'skip' as const,
					numPassingAsserts: result.numPassingAsserts,
					startedAt: result.startedAt ?? Date.now(),
					status: result.status,
					title: result.title,
				}
				this.startSuites(result.ancestorTitles, test.path, testCaseWithStartTime.startedAt)

				this.startStep(testCaseWithStartTime, test.path)
				this.finishStep(testCaseWithStartTime, test.path)
			}
		})

		const storageKeys = this.storage.getAllKeys()
		for (const key of storageKeys) {
			if (key.startsWith('suiteContext_') && key.includes(testResult.testFilePath)) {
				const codeRef = this.storage.getItem<string>(key)
				if (codeRef) {
					const suiteKey = `suite_${codeRef}`
					const suiteTempId = this.storage.getItem<string>(suiteKey)
					if (suiteTempId) this.finishSuite(suiteTempId, suiteKey)
				}
			}
		}
	}

	/**
	 * Called when the entire Jest test run completes
	 *
	 * @returns Promise that resolves when all ReportPortal operations are complete
	 * @description Processes all queued async operations and finishes the launch in ReportPortal.
	 * Ensures all test data is properly synchronized before the reporter shuts down.
	 */
	async onRunComplete(): Promise<void> {
		// Always save commands to cache for replay capability
		this.saveCacheToFile()

		// Always send to ReportPortal and cache for replay capability
		const launchId = this.storage.getItem<string>('launchId')

		// Always cache the command for replay capability
		this.cacheCommand({ data: { endTime: Date.now() }, launchId, type: 'finishLaunch' })

		// Send to ReportPortal
		await this.asyncQueue.process()
		const { promise } = this.client.finishLaunch(launchId, { endTime: Date.now() })

		this.asyncQueue.catchAndLogError(promise, 'Error finishing launch: ')
		await promise

		console.log(`Test run completed. Commands cached in memory ${this.saveToFile ? `and saved to ${this.cacheFilePath}` : ''} for replay capability.`)
	}

	/**
	 * Creates and starts test suites in hierarchical order
	 *
	 * @param suiteTitles - Array of suite names representing the hierarchy (e.g., ["describe1", "describe2"])
	 * @param filePath - Absolute path to the test file
	 * @param startTime - Timestamp when the suite execution started
	 * @description Processes suite hierarchy to create parent-child relationships in ReportPortal.
	 * Uses deterministic codeRef generation to ensure consistent test identification across runs.
	 */
	private startSuites(suiteTitles: string[], filePath: string, startTime: number): void {
		let currentSuitePath = ''
		let parentCodeRef = ''

		for (const suiteTitle of suiteTitles) {
			const fullSuiteName = currentSuitePath ? `${currentSuitePath}/${suiteTitle}` : suiteTitle
			// Create a deterministic key for this suite based on file path and suite hierarchy
			const suiteContextKey = `${filePath}:${fullSuiteName}`

			// Create deterministic codeRef using the private function
			const codeRef = this.buildCodeReference(filePath, fullSuiteName)

			// Check if we already have this suite started
			let storedCodeRef = this.storage.getItem<string>(`suiteContext_${suiteContextKey}`)
			if (!storedCodeRef) {
				storedCodeRef = codeRef
				this.storage.setItem(`suiteContext_${suiteContextKey}`, storedCodeRef)
			}

			this.startSuite(suiteTitle, storedCodeRef, parentCodeRef, startTime)
			parentCodeRef = storedCodeRef
			currentSuitePath = fullSuiteName
		}
	}

	/**
	 * Starts a single test suite in ReportPortal
	 *
	 * @param title - The suite title/name
	 * @param codeRef - Deterministic code reference for the suite
	 * @param parentCodeRef - Code reference of the parent suite (empty string if root level)
	 * @param startTime - Timestamp when the suite started (defaults to current time)
	 * @description Creates a suite test item in ReportPortal with proper parent-child relationships.
	 * Prevents duplicate suite creation by checking storage before starting.
	 */
	private startSuite(title: string, codeRef: string, parentCodeRef = '', startTime = Date.now()): void {
		const suiteKey = `suite_${codeRef}`
		if (this.storage.getItem<string>(suiteKey)) {
			return
		}

		const parentKey = `suite_${parentCodeRef}`
		const parentId = parentCodeRef ? this.storage.getItem<string>(parentKey) : undefined
		const launchId = this.storage.getItem<string>('launchId')

		const testItemData = {
			codeRef,
			name: title,
			startTime,
			type: TEST_ITEM_TYPES.SUITE,
		}

		// Always send to ReportPortal and cache for replay capability
		const { tempId, promise } = this.client.startTestItem(testItemData, launchId, parentId)
		this.storage.setItem(suiteKey, tempId)

		// Always cache the command for replay capability
		this.cacheCommand({
			data: testItemData,
			launchId,
			tempId,
			type: 'startTestItem',
			...(parentId && { parentId }),
		})

		// Send to ReportPortal
		this.asyncQueue.catchAndLogError(promise)
		this.asyncQueue.enqueue(promise)
	}

	/**
	 * Starts a test step (individual test case) in ReportPortal
	 *
	 * @param test - Test case start information including titles and timing
	 * @param testPath - Absolute path to the test file
	 * @description Creates a test step under the appropriate parent suite with deterministic codeRef.
	 * Handles test retries by maintaining an array of temp IDs for the same test.
	 */
	private startStep(test: Circus.TestCaseStartInfo, testPath: string): void {
		const fullStepName = `${test.ancestorTitles.join('/')}/${test.title}`
		const stepContextKey = `${testPath}:${fullStepName}`

		// Create deterministic codeRef using the private function
		const codeRef = this.buildCodeReference(testPath, fullStepName)

		// Check if we already have this step started
		let storedCodeRef = this.storage.getItem<string>(`stepContext_${stepContextKey}`)
		if (!storedCodeRef) {
			storedCodeRef = codeRef
			this.storage.setItem(`stepContext_${stepContextKey}`, storedCodeRef)
		}

		const stepKey = `step_${storedCodeRef}`
		const retryIds = this.storage.getItem<string[]>(stepKey)
		const isRetried = !!retryIds

		// Get parent suite ID
		const parentSuiteContextKey = `${testPath}:${test.ancestorTitles.join('/')}`
		const parentCodeRef = this.storage.getItem<string>(`suiteContext_${parentSuiteContextKey}`)
		const parentKey = `suite_${parentCodeRef}`
		const parentId = parentCodeRef ? this.storage.getItem<string>(parentKey) : undefined
		const launchId = this.storage.getItem<string>('launchId')

		const testItemData = {
			codeRef: storedCodeRef,
			name: test.title,
			retry: isRetried,
			startTime: test.startedAt ?? Date.now(),
			type: TEST_ITEM_TYPES.STEP,
		}

		let tempIdToStore: string[]

		// Always send to ReportPortal and cache for replay capability
		const { tempId, promise } = this.client.startTestItem(testItemData, launchId, parentId)
		tempIdToStore = [tempId]
		if (isRetried && retryIds) tempIdToStore = retryIds.concat(tempIdToStore)
		this.storage.setItem(stepKey, tempIdToStore)

		// Always cache the command for replay capability
		this.cacheCommand({
			data: testItemData,
			launchId,
			tempId,
			type: 'startTestItem',
			...(parentId && { parentId }),
		})

		// Send to ReportPortal
		this.asyncQueue.catchAndLogError(promise)
		this.asyncQueue.enqueue(promise)
	}

	/**
	 * Finishes a test step with results and artifacts
	 *
	 * @param test - Test case result containing status and failure information
	 * @param testPath - Absolute path to the test file
	 * @description Completes the test step in ReportPortal with final status, error logs, and artifacts.
	 * Handles error reporting and artifact attachment for failed tests.
	 */
	private finishStep(test: TestCaseResult, testPath: string): void {
		const fullName = `${test.ancestorTitles.join('/')}/${test.title}`
		const stepContextKey = `${testPath}:${fullName}`
		const codeRef = this.storage.getItem<string>(`stepContext_${stepContextKey}`)

		if (!codeRef) {
			process.stderr.write(`Could not finish Test Step - step context not found for "${stepContextKey}"`)
			return
		}

		const stepKey = `step_${codeRef}`
		const tempStepIds = this.storage.getItem<string[]>(stepKey)
		const tempStepId = Array.isArray(tempStepIds) ? tempStepIds.shift() : undefined

		if (tempStepIds && tempStepId) this.storage.setItem(stepKey, tempStepIds)

		if (!tempStepId) {
			process.stderr.write(`Could not finish Test Step - "${codeRef}". tempId not found\n`)
			return
		}

		const errorMsg = test.failureMessages?.[0] ?? ''
		const testName = test.fullName
		const testStatus = test.status === 'pending' ? 'skipped' : (test.status ?? 'skipped')

		this.finishTestStep({ error: errorMsg, fullName: testName, status: testStatus, tempStepId: tempStepId })
	}

	/**
	 * Sends a log message with optional file attachment to ReportPortal
	 *
	 * @param params - Object containing log parameters
	 * @param params.itemTempId - Temporary ID of the test item to attach the log to
	 * @param params.saveLogRQ - Log request object with level and message
	 * @param params.fileObj - Optional file object for attachments (screenshots, videos, etc.)
	 * @description Sends structured log entries to ReportPortal with proper timing and formatting.
	 * Supports file attachments for visual artifacts.
	 */
	public sendLog({ saveLogRQ, fileObj, itemTempId }: { itemTempId: string; saveLogRQ: SaveLogRQ; fileObj?: FileObj }): void {
		const logData = {
			level: saveLogRQ.level ?? LOG_LEVEL.INFO,
			message: saveLogRQ.message ?? '',
			time: this.client.helpers.now(),
		}

		// Always send to ReportPortal and cache for replay capability
		// Always cache the command for replay capability
		this.cacheCommand({
			data: logData,
			tempId: itemTempId,
			type: 'sendLog',
			...(fileObj && {
				fileData: {
					content: fileObj.content,
					name: fileObj.name,
					type: fileObj.type,
				},
			}),
		})

		// Send to ReportPortal
		const { promise } = this.client.sendLog(itemTempId, logData, fileObj)
		this.asyncQueue.catchAndLogError(promise)
		this.asyncQueue.enqueue(promise)
	}

	/**
	 * Completes a test step with final status and metadata
	 *
	 * @param params - Object containing step completion parameters
	 * @param params.tempStepId - Temporary ID of the step to finish
	 * @param params.fullName - Full name of the test (optional, used for artifact attachment)
	 * @param params.status - Final test status (passed, failed, skipped, etc.)
	 * @param params.error - Error message if the test failed (optional)
	 * @description Finalizes the test step in ReportPortal with status, description, and issue information.
	 * Automatically attaches artifacts for failed tests and logs error messages.
	 */
	private finishTestStep({ error, fullName, tempStepId, status }: { tempStepId: string; fullName?: string; status: string; error?: string }): void {
		const issue = this.reportOptions.skippedIssue === false ? { issueType: 'NOT_ISSUE' } : undefined
		const description = this.reportOptions.extendTestDescriptionWithLastError === false ? undefined : `\`\`\`error\n${error}\n\`\`\``

		if (error) {
			this.sendLog({
				itemTempId: tempStepId,
				saveLogRQ: {
					level: LOG_LEVEL.ERROR,
					message: error,
				},
			})
		}

		fullName && this.attachArtifacts(fullName, tempStepId)

		const finishData = {
			status,
			...(issue && { issue }),
			...(description && { description }),
		}

		// Always send to ReportPortal and cache for replay capability
		// Always cache the command for replay capability
		this.cacheCommand({ data: finishData, tempId: tempStepId, type: 'finishTestItem' })

		// Send to ReportPortal
		const { promise } = this.client.finishTestItem(tempStepId, finishData)
		this.asyncQueue.catchAndLogError(promise)
		this.asyncQueue.enqueue(promise)
	}

	/**
	 * Attaches test artifacts (screenshots and videos) to ReportPortal
	 *
	 * @param fullName - Full test name used to locate artifact files
	 * @param tempStepId - Temporary ID of the test step to attach artifacts to
	 * @description Searches for and attaches Detox-generated artifacts (PNG screenshots and MP4 videos)
	 * to failed test steps. Uses the configured artifacts path and test naming conventions.
	 */
	private attachArtifacts(fullName: string, tempStepId: string): void {
		if (this.reportOptions.artifactsPath) {
			const artifactFolder = this.findArtifactFolder(this.reportOptions.artifactsPath, fullName)

			if (artifactFolder) {
				// Check for all screenshot files
				try {
					const files = fs.readdirSync(artifactFolder)
					const pngFiles = files.filter(file => path.extname(file).toLowerCase() === '.png')

					for (const pngFile of pngFiles) {
						const imagePath = path.join(artifactFolder, pngFile)
						if (fs.existsSync(imagePath)) {
							const fileNameWithoutExt = path.basename(pngFile, path.extname(pngFile))
							const image = {
								content: fs.readFileSync(imagePath).toString('base64'),
								name: pngFile,
								type: 'image/png',
							}
							this.sendLog({
								fileObj: image,
								itemTempId: tempStepId,
								saveLogRQ: {
									level: LOG_LEVEL.ERROR,
									message: fileNameWithoutExt,
								},
							})
						}
					}
				} catch (error) {
					console.warn(`Failed to read PNG files from artifact folder: ${artifactFolder}`, error)
				}

				// Check for video
				const videoPath = path.join(artifactFolder, 'test.mp4')
				if (fs.existsSync(videoPath)) {
					const video = {
						content: fs.readFileSync(videoPath).toString('base64'),
						name: 'test.mp4',
						type: 'video/mp4',
					}
					this.sendLog({
						fileObj: video,
						itemTempId: tempStepId,
						saveLogRQ: {
							level: LOG_LEVEL.ERROR,
							message: 'Video:',
						},
					})
				}
			}
		}
	}

	/**
	 * Finishes a test suite in ReportPortal
	 *
	 * @param tempTestId - Temporary ID of the suite to finish
	 * @param key - Storage key for the suite to clean up
	 * @description Completes a test suite in ReportPortal and removes it from local storage.
	 * Called when all tests in a suite have completed execution.
	 */
	private finishSuite(tempTestId: string, key: string): void {
		if (!tempTestId) {
			return
		}

		const finishData = { endTime: Date.now() }

		this.cacheCommand({ data: finishData, tempId: tempTestId, type: 'finishTestItem' })
		// Send to ReportPortal
		const { promise } = this.client.finishTestItem(tempTestId, finishData)
		this.asyncQueue.catchAndLogError(promise)
		this.asyncQueue.enqueue(promise)
		this.storage.removeItem(key)
	}

	/**
	 * Generate a deterministic codeRef based on file path and test hierarchy
	 *
	 * @param testPath - The absolute file path of the test
	 * @param hierarchy - The test hierarchy string (suite/step names joined with '/')
	 * @returns A deterministic codeRef string in format "relative/path/to/file:hierarchy"
	 * @description Creates consistent, deterministic identifiers for test items across multiple runs.
	 * This enables proper test history tracking and analytics in ReportPortal by ensuring
	 * the same test always gets the same codeRef regardless of execution order or timing.
	 */
	private buildCodeReference(testPath: string, hierarchy: string): string {
		const relativePath = path.relative(process.cwd(), testPath).replace(/\\/g, '/')
		const cleanPath = relativePath.replace(/\.(js|ts|jsx|tsx)$/, '')
		return `${cleanPath}:${hierarchy}`
	}

	/**
	 * Finds the artifact folder for a test using Detox's exact folder naming convention
	 *
	 * @param root - Root artifacts directory path to search in
	 * @param testFullName - Full test name from Jest (test.fullName)
	 * @returns Full path to the artifact folder if found, null otherwise
	 * @description Uses Detox's ArtifactPathBuilder logic to find the test's artifact folder.
	 * Detox creates folders directly in the artifacts directory with pattern: "✗ {sanitized test fullName}"
	 */
	private findArtifactFolder(root: string, testFullName: string): string | null {
		try {
			// Try Detox's expected pattern first
			const prefix = '✗ '
			const sanitizedTestName = this.sanitizeFilename(testFullName)
			const expectedFolderName = `${prefix}${sanitizedTestName}`

			let expectedPath = path.join(root, expectedFolderName)
			if (fs.existsSync(expectedPath)) {
				return expectedPath
			}

			// Try with the XXX_ transformation we observe in actual folders
			const transformedTestName = testFullName.replace(/^(\w+)\s/, '$1_ ')
			const transformedSanitized = this.sanitizeFilename(transformedTestName)
			const transformedFolderName = `${prefix}${transformedSanitized}`

			expectedPath = path.join(root, transformedFolderName)
			if (fs.existsSync(expectedPath)) {
				return expectedPath
			}

			// Fallback: look directly in the artifacts directory for any folder starting with ✗
			// No recursive search needed since Detox creates test folders directly in the artifacts root
			const entries = fs.readdirSync(root, { withFileTypes: true })
			for (const entry of entries) {
				if (entry.isDirectory() && entry.name.startsWith('✗')) {
					return path.join(root, entry.name)
				}
			}

			return null
		} catch {
			return null
		}
	}

	/**
	 * Sanitizes filename using the same logic as Detox's sanitize-filename with replacement: '_'
	 * This mimics the constructSafeFilename function from Detox
	 */
	private sanitizeFilename(input: string): string {
		// Basic sanitization - replace unsafe characters with underscores
		// This mimics sanitize-filename package behavior with replacement: '_'
		return input
			.replace(/[<>:"/\\|?*]/g, '_') // Replace filesystem unsafe chars
			.replace(/^\.+$/, '_') // Replace dots-only names
			.replace(/\.$/, '_') // Remove trailing dots
			.trim()
	}

	/**
	 * Caches a ReportPortal command for later execution
	 */
	private cacheCommand(params: {
		type: CachedCommand['type']
		data: Record<string, unknown>
		tempId?: string
		launchId?: string
		parentId?: string
		fileData?: CachedCommand['fileData']
	}): void {
		const command: CachedCommand = {
			data: params.data,
			timestamp: Date.now(),
			type: params.type,
			...(params.tempId && { tempId: params.tempId }),
			...(params.launchId && { launchId: params.launchId }),
			...(params.parentId && { parentId: params.parentId }),
			...(params.fileData && { fileData: params.fileData }),
		}

		this.cachedCommands.push(command)

		// Only save to file periodically or for critical commands to avoid excessive I/O
		if (
			this.saveToFile &&
			(params.type === 'startLaunch' || params.type === 'finishLaunch' || this.cachedCommands.length % 10 === 0) // Save every 10 commands
		) {
			this.saveCacheToFile()
		}
	}
}
