import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
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

/**
 * Compresses base64-encoded content using gzip
 * @param base64Content - Base64 string to compress
 * @returns Compressed base64 string
 */
function compressArtifact(base64Content: string): string {
	try {
		const buffer = Buffer.from(base64Content, 'base64')
		const compressed = gzipSync(buffer)
		return compressed.toString('base64')
	} catch (error) {
		console.warn('Failed to compress artifact, using original:', error)
		return base64Content
	}
}

interface ExtendedClientConfig extends ClientConfig {
	artifactsPath?: string | undefined
	extendTestDescriptionWithLastError: boolean
	saveToFile?: boolean
	cacheFilePath?: string
	offlineMode?: boolean
	cacheArtifacts?: boolean
	compressArtifacts?: boolean
	maxCacheSize?: number // Max cache size in bytes (default: 50MB)
	flushInterval?: number // Flush cache every N commands (default: 50)
}

export default class DetoxReporter implements Reporter {
	private readonly reportOptions: ExtendedClientConfig
	private readonly client: RPClientInterface

	private asyncQueue: AsyncQueue<unknown>
	private storage: Storage
	private cachedCommands: CachedCommand[]
	private failedTests: Map<string, { fullName: string; tempStepId: string; error?: string; issue?: { issueType: string }; description?: string }>
	private currentCacheSize: number
	private commandCounter: number

	constructor(_globalConfig: Config.GlobalConfig, options: Partial<ExtendedClientConfig>) {
		this.reportOptions = {
			apiKey: process.env.RP_API_KEY ?? options.apiKey ?? '',
			artifactsPath: process.env.DETOX_ARTIFACTS_PATH ?? '.artifacts',
			cacheArtifacts: options.cacheArtifacts ?? true,
			cacheFilePath: options.cacheFilePath ?? './rp-cache.json',
			compressArtifacts: options.compressArtifacts ?? true,
			endpoint: process.env.RP_ENDPOINT ?? options.endpoint ?? '',
			extendTestDescriptionWithLastError: options.extendTestDescriptionWithLastError ?? true,
			flushInterval: options.flushInterval ?? 50, // Flush every 50 commands
			launch: process.env.RP_LAUNCH ?? options.launch ?? '',
			maxCacheSize: options.maxCacheSize ?? 50 * 1024 * 1024, // 50MB default
			offlineMode: options.offlineMode ?? false,
			project: process.env.RP_PROJECT_NAME ?? options.project ?? 'Detox Agent Reporter',
			saveToFile: options.saveToFile ?? true,
			...(options.attributes && { attributes: options.attributes }),
			...(options.debug !== undefined && { debug: options.debug }),
			...(options.description && { description: process.env.RP_DESCRIPTION ?? options.description }),
			...(options.isLaunchMergeRequired !== undefined && { isLaunchMergeRequired: options.isLaunchMergeRequired }),
			...(options.launchUuidPrint !== undefined && { launchUuidPrint: options.launchUuidPrint }),
			...(options.launchUuidPrintOutput && { launchUuidPrintOutput: options.launchUuidPrintOutput }),
			...(options.mode && { mode: process.env.RP_MODE || options.mode }),
			...(options.restClientConfig && {
				restClientConfig: {
					...options.restClientConfig,
					// Enable debug logging to see actual API calls
					debug: options.restClientConfig.debug ?? options.debug ?? false,
				},
			}),
			...(options.skippedIssue !== undefined && { skippedIssue: options.skippedIssue }),
		}

		this.client = new RPClient(this.reportOptions)
		this.asyncQueue = new AsyncQueue<unknown>()
		this.storage = new Storage()

		// Initialize caching properties
		this.cachedCommands = []
		this.failedTests = new Map()
		this.currentCacheSize = 0
		this.commandCounter = 0
		// Log mode on startup
		if (this.reportOptions.offlineMode) {
		}
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

		let tempId: string

		if (this.reportOptions.offlineMode) {
			// In offline mode, generate our own tempId without calling ReportPortal
			tempId = `offline-launch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		} else {
			// In normal mode, call ReportPortal and get real tempId
			const { tempId: rpTempId, promise } = this.client.startLaunch(launchData)
			tempId = rpTempId
			this.asyncQueue.catchAndLogError(promise, 'Error starting launch: ')
			this.asyncQueue.enqueue(promise)
		}

		this.storage.setItem('launchId', tempId)
		this.cacheCommand({ data: launchData, tempId, type: 'startLaunch' })
	}

	/**
	 * Saves cached commands to file if saveToFile option is enabled
	 */
	private saveCacheToFile(): void {
		if (!this.reportOptions.saveToFile || !this.reportOptions.cacheFilePath) {
			return
		}

		try {
			const cacheDir = path.dirname(this.reportOptions.cacheFilePath)

			// Create artifacts directory if caching artifacts
			const artifactsDir = path.join(cacheDir, 'rp-cache-artifacts')
			if (this.reportOptions.cacheArtifacts && !fs.existsSync(artifactsDir)) {
				fs.mkdirSync(artifactsDir, { recursive: true })
			}

			// Process commands: extract artifacts to separate files
			const processedCommands = this.cachedCommands.map((cmd, idx) => {
				if (cmd.fileData?.content) {
					// Skip artifact caching if disabled
					if (!this.reportOptions.cacheArtifacts) {
						return {
							...cmd,
							fileData: {
								name: cmd.fileData.name,
								type: cmd.fileData.type,
								// Content excluded - metadata only
							},
						}
					}

					// Save artifact to separate file
					const artifactFileName = `artifact-${idx}-${cmd.timestamp}.dat`
					const artifactPath = path.join(artifactsDir, artifactFileName)

					let contentToSave = cmd.fileData.content

					// Compress if enabled
					if (this.reportOptions.compressArtifacts) {
						contentToSave = compressArtifact(contentToSave)
					}

					fs.writeFileSync(artifactPath, contentToSave, 'utf8')

					return {
						...cmd,
						fileData: {
							compressed: this.reportOptions.compressArtifacts,
							contentPath: path.relative(cacheDir, artifactPath),
							name: cmd.fileData.name,
							type: cmd.fileData.type,
						},
					}
				}
				return cmd
			})

			const cacheData = {
				commands: processedCommands,
				reportOptions: this.reportOptions,
				timestamp: Date.now(),
			}

			// Ensure the directory exists before writing the file
			if (!fs.existsSync(cacheDir)) {
				fs.mkdirSync(cacheDir, { recursive: true })
			}

			fs.writeFileSync(this.reportOptions.cacheFilePath, JSON.stringify(cacheData, null, 2))

			// Generate replay script when we finish caching
			if (this.cachedCommands.length > 0) {
				const replayScriptPath = this.reportOptions.cacheFilePath.replace('.json', '-replay.js')
				generateReplayScript(this.reportOptions.cacheFilePath, replayScriptPath)
			}

			// Reset cache size after flushing to disk
			// Artifacts are now in external files, so they don't count toward memory size
			this.currentCacheSize = 0
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

		// Attach artifacts for failed tests and then finish them
		// At this point, Detox has finished writing all artifact files including videos
		for (const [fullName, testInfo] of this.failedTests.entries()) {
			// Check if this test belongs to the current test file
			if (test.path === testResult.testFilePath) {
				// Attach artifacts while the test item is still open
				this.attachArtifacts(fullName, testInfo.tempStepId)

				// Now finish the test item with the stored status/error info
				const finishData = {
					status: 'failed',
					...(testInfo.issue && { issue: testInfo.issue }),
					...(testInfo.description && { description: testInfo.description }),
				}

				// Always cache the command for replay capability
				this.cacheCommand({ data: finishData, tempId: testInfo.tempStepId, type: 'finishTestItem' })

				// Only send to ReportPortal if not in offline mode
				if (!this.reportOptions.offlineMode) {
					const { promise } = this.client.finishTestItem(testInfo.tempStepId, finishData)
					this.asyncQueue.catchAndLogError(promise)
					this.asyncQueue.enqueue(promise)
				}

				// Clean up after processing
				this.failedTests.delete(fullName)
			}
		}

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
	} /**
	 * Called when the entire Jest test run completes
	 *
	 * @returns Promise that resolves when all ReportPortal operations are complete
	 * @description Processes all queued async operations and finishes the launch in ReportPortal.
	 * Ensures all test data is properly synchronized before the reporter shuts down.
	 */
	async onRunComplete(): Promise<void> {
		// Always save commands to cache for replay capability
		this.saveCacheToFile()

		const launchId = this.storage.getItem<string>('launchId')

		// Always cache the command for replay capability
		this.cacheCommand({ data: { endTime: Date.now() }, launchId, type: 'finishLaunch' })

		if (this.reportOptions.offlineMode) {
			// In offline mode, just save the cache and exit
			if (this.cachedCommands.length > 0) {
				this.reportOptions.cacheFilePath?.replace('.json', '-replay.js') ?? './rp-replay.js'
			}
			return
		}

		// Send to ReportPortal in normal mode
		await this.asyncQueue.process()
		const { promise } = this.client.finishLaunch(launchId, { endTime: Date.now() })

		this.asyncQueue.catchAndLogError(promise, 'Error finishing launch: ')
		await promise
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

		let tempId: string

		if (this.reportOptions.offlineMode) {
			// In offline mode, generate our own tempId without calling ReportPortal
			tempId = `offline-suite-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		} else {
			// In normal mode, call ReportPortal and get real tempId
			const { tempId: rpTempId, promise } = this.client.startTestItem(testItemData, launchId, parentId)
			tempId = rpTempId
			this.asyncQueue.catchAndLogError(promise)
			this.asyncQueue.enqueue(promise)
		}

		this.storage.setItem(suiteKey, tempId)

		// Always cache the command for replay capability
		this.cacheCommand({
			data: testItemData,
			launchId,
			tempId,
			type: 'startTestItem',
			...(parentId && { parentId }),
		})
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

		let tempId: string
		let tempIdToStore: string[]

		if (this.reportOptions.offlineMode) {
			// In offline mode, generate our own tempId without calling ReportPortal
			tempId = `offline-step-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		} else {
			// In normal mode, call ReportPortal and get real tempId
			const { tempId: rpTempId, promise } = this.client.startTestItem(testItemData, launchId, parentId)
			tempId = rpTempId
			this.asyncQueue.catchAndLogError(promise)
			this.asyncQueue.enqueue(promise)
		}

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

		// Only send to ReportPortal if not in offline mode
		if (!this.reportOptions.offlineMode) {
			const { promise } = this.client.sendLog(itemTempId, logData, fileObj)
			this.asyncQueue.catchAndLogError(promise)
			this.asyncQueue.enqueue(promise)
		}
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
	 * For failed tests, defers finishing until artifacts can be attached in onTestResult.
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

		// Store failed tests for deferred completion
		// We need to attach artifacts BEFORE finishing the test item
		// Artifacts will be attached in onTestResult when Detox has finished writing files
		if (fullName && status === 'failed') {
			this.failedTests.set(fullName, {
				fullName,
				tempStepId,
				...(error && { error }),
				...(issue && { issue }),
				...(description && { description }),
			})
			// Don't finish the test item yet - it will be finished in onTestResult after artifacts are attached
			return
		}

		// For passed/skipped tests, finish immediately
		const finishData = {
			status,
			...(issue && { issue }),
			...(description && { description }),
		}

		// Always cache the command for replay capability
		this.cacheCommand({ data: finishData, tempId: tempStepId, type: 'finishTestItem' })

		// Only send to ReportPortal if not in offline mode
		if (!this.reportOptions.offlineMode) {
			const { promise } = this.client.finishTestItem(tempStepId, finishData)
			this.asyncQueue.catchAndLogError(promise)
			this.asyncQueue.enqueue(promise)
		}
	}

	/**
	 * Attaches test artifacts (screenshots and videos) to ReportPortal
	 *
	 * @param fullName - Full test name used to locate artifact files
	 * @param tempStepId - Temporary ID of the test step to attach artifacts to
	 * @description Searches for and attaches Detox-generated artifacts (PNG screenshots and MP4 videos)
	 * to failed test steps. Uses the configured artifacts path and test naming conventions.
	 * Called after suite finishes to ensure Detox has completed writing all files.
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
							const imageBuffer = fs.readFileSync(imagePath)
							const image = {
								content: imageBuffer.toString('base64'),
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

				// Check for video files (*.mp4)
				try {
					const files = fs.readdirSync(artifactFolder)
					const mp4Files = files.filter(file => path.extname(file).toLowerCase() === '.mp4')

					for (const mp4File of mp4Files) {
						const videoPath = path.join(artifactFolder, mp4File)
						if (fs.existsSync(videoPath)) {
							const fileNameWithoutExt = path.basename(mp4File, path.extname(mp4File))
							const videoBuffer = fs.readFileSync(videoPath)
							const video = {
								content: videoBuffer.toString('base64'),
								name: mp4File,
								type: 'video/mp4',
							}
							this.sendLog({
								fileObj: video,
								itemTempId: tempStepId,
								saveLogRQ: {
									level: LOG_LEVEL.ERROR,
									message: fileNameWithoutExt,
								},
							})
						} else {
							console.warn(`[DetoxReporter] Video file does not exist: ${videoPath}`)
						}
					}
				} catch (error) {
					console.warn(`Failed to read MP4 files from artifact folder: ${artifactFolder}`, error)
				}

				// Also check parent (session) folder for videos
				// Videos are often stored at session level, not test level
				try {
					const parentFolder = path.dirname(artifactFolder)

					if (fs.existsSync(parentFolder)) {
						const parentFiles = fs.readdirSync(parentFolder)
						const parentMp4Files = parentFiles.filter(file => path.extname(file).toLowerCase() === '.mp4')

						for (const mp4File of parentMp4Files) {
							const videoPath = path.join(parentFolder, mp4File)
							if (fs.existsSync(videoPath)) {
								const fileNameWithoutExt = path.basename(mp4File, path.extname(mp4File))
								const videoBuffer = fs.readFileSync(videoPath)
								const video = {
									content: videoBuffer.toString('base64'),
									name: mp4File,
									type: 'video/mp4',
								}
								this.sendLog({
									fileObj: video,
									itemTempId: tempStepId,
									saveLogRQ: {
										level: LOG_LEVEL.ERROR,
										message: fileNameWithoutExt,
									},
								})
							}
						}
					}
				} catch (error) {
					console.warn(`Failed to read MP4 files from parent folder`, error)
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

		// Only send to ReportPortal if not in offline mode
		if (!this.reportOptions.offlineMode) {
			const { promise } = this.client.finishTestItem(tempTestId, finishData)
			this.asyncQueue.catchAndLogError(promise)
			this.asyncQueue.enqueue(promise)
		}

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
	 * @description Searches for test artifacts both directly in root and in session subdirectories.
	 * Detox creates session folders with pattern: {config}.{timestamp} (e.g., XXX_XXXX.2025-10-20 15-55-08Z)
	 * Test folders inside have pattern: "✗ {sanitized test fullName}"
	 */
	private findArtifactFolder(root: string, testFullName: string): string | null {
		try {
			const prefix = '✗ '
			const sanitizedTestName = this.sanitizeFilename(testFullName)
			const expectedFolderName = `${prefix}${sanitizedTestName}`

			// Try with the XXX_ transformation (e.g., "XXX:" → "XXX_")
			const transformedTestName = testFullName.replace(/^(\w+)\s/, '$1_ ')
			const transformedSanitized = this.sanitizeFilename(transformedTestName)
			const transformedFolderName = `${prefix}${transformedSanitized}`

			// First, try directly in the artifacts root (backward compatibility)
			let directPath = path.join(root, expectedFolderName)
			if (fs.existsSync(directPath)) {
				return directPath
			}

			directPath = path.join(root, transformedFolderName)
			if (fs.existsSync(directPath)) {
				return directPath
			}

			// Search in session subdirectories (e.g., pma_android.2025-10-20 15-55-08Z)
			const entries = fs.readdirSync(root, { withFileTypes: true })
			for (const entry of entries) {
				// Skip files and folders starting with ✗ (those are direct test folders, already checked)
				if (!entry.isDirectory() || entry.name.startsWith('✗')) {
					continue
				}

				// This is potentially a session folder, search inside it
				const sessionPath = path.join(root, entry.name)

				// Try expected folder name
				let sessionArtifactPath = path.join(sessionPath, expectedFolderName)
				if (fs.existsSync(sessionArtifactPath)) {
					return sessionArtifactPath
				}

				// Try transformed folder name
				sessionArtifactPath = path.join(sessionPath, transformedFolderName)
				if (fs.existsSync(sessionArtifactPath)) {
					return sessionArtifactPath
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
		// In offline mode or when caching artifacts, save large files immediately to external storage
		if (params.fileData?.content && this.reportOptions.cacheArtifacts) {
			const estimatedSize = params.fileData.content.length

			// For offline mode or large artifacts, write to external file immediately
			const shouldWriteImmediately =
				this.reportOptions.offlineMode ||
				estimatedSize > 1024 * 1024 || // > 1MB
				(this.reportOptions.maxCacheSize && this.currentCacheSize + estimatedSize > this.reportOptions.maxCacheSize)

			if (shouldWriteImmediately && this.reportOptions.cacheFilePath) {
				const cacheDir = path.dirname(this.reportOptions.cacheFilePath)
				const artifactsDir = path.join(cacheDir, 'rp-cache-artifacts')

				if (!fs.existsSync(artifactsDir)) {
					fs.mkdirSync(artifactsDir, { recursive: true })
				}

				const timestamp = Date.now()
				const artifactFileName = `artifact-${this.cachedCommands.length}-${timestamp}.dat`
				const artifactPath = path.join(artifactsDir, artifactFileName)

				try {
					let contentToSave = params.fileData.content

					// Compress if enabled
					if (this.reportOptions.compressArtifacts) {
						contentToSave = compressArtifact(contentToSave)
					}

					fs.writeFileSync(artifactPath, contentToSave, 'utf8')

					// Replace content with reference
					params.fileData = {
						contentPath: path.relative(cacheDir, artifactPath),
						name: params.fileData.name,
						type: params.fileData.type,
						...(this.reportOptions.compressArtifacts && { compressed: this.reportOptions.compressArtifacts }),
					}

					// Don't count external files toward memory size
					// (they're already on disk)
				} catch (error) {
					console.error('Failed to write artifact to external file:', error)
					// Keep in memory as fallback
					this.currentCacheSize += estimatedSize
				}
			} else {
				// Keep in memory - update cache size tracker
				this.currentCacheSize += estimatedSize

				// Trigger flush if approaching limit
				if (this.reportOptions.maxCacheSize && this.currentCacheSize > this.reportOptions.maxCacheSize * 0.8) {
					this.saveCacheToFile()
				}
			}
		}

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
		this.commandCounter++

		// In offline mode, save more frequently to ensure we don't lose data
		// In normal mode, only save to file periodically or for critical commands to avoid excessive I/O
		if (this.reportOptions.saveToFile) {
			const flushInterval = this.reportOptions.flushInterval ?? 50
			const shouldSave =
				this.reportOptions.offlineMode ||
				params.type === 'startLaunch' ||
				params.type === 'finishLaunch' ||
				this.commandCounter % flushInterval === 0 || // Flush based on configured interval
				this.currentCacheSize > (this.reportOptions.maxCacheSize ?? 50 * 1024 * 1024) * 0.8 // Flush at 80% capacity

			if (shouldSave) {
				this.saveCacheToFile()
			}
		}
	}
}
