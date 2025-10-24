import { Reporter, Test, TestCaseResult, TestResult } from '@jest/reporters';
import { Config, Circus } from '@jest/types';
import { ClientConfig, SaveLogRQ, FileObj } from '@reportportal/client-javascript';

interface ExtendedClientConfig extends ClientConfig {
    artifactsPath?: string | undefined;
    extendTestDescriptionWithLastError: boolean;
    saveToFile?: boolean;
    cacheFilePath?: string;
    offlineMode?: boolean;
}
declare class DetoxReporter implements Reporter {
    private readonly reportOptions;
    private readonly client;
    private asyncQueue;
    private storage;
    private cachedCommands;
    private failedTests;
    constructor(_globalConfig: Config.GlobalConfig, options: Partial<ExtendedClientConfig>);
    /**
     * Called when Jest test run starts
     *
     * @description Initiates a new launch in ReportPortal with configured attributes and description.
     * Sets up the launch ID in storage for subsequent test items to reference.
     * Always caches commands for replay capability.
     */
    onRunStart(): void;
    /**
     * Saves cached commands to file if saveToFile option is enabled
     */
    private saveCacheToFile;
    /**
     * Called when a test case starts execution
     *
     * @param test - Jest test object containing file path and metadata
     * @param testCaseStartInfo - Test case start information including ancestor titles and timing
     * @description Initiates the test suite hierarchy and starts the individual test step in ReportPortal.
     * Creates necessary parent suites if they don't exist and establishes the test structure.
     */
    onTestCaseStart(test: Test, testCaseStartInfo: Circus.TestCaseStartInfo): void;
    /**
     * Called when a test case completes execution
     *
     * @param test - Jest test object containing file path and metadata
     * @param testCaseResult - Test case result information including status and failure details
     * @description Finishes the test step in ReportPortal with the final status and any error information.
     * Handles attachment of artifacts if the test failed.
     */
    onTestCaseResult(test: Test, testCaseResult: TestCaseResult): void;
    /**
     * Called when a test file completes execution
     *
     * @param test - Jest test object containing file path and metadata
     * @param testResult - Complete test file results including all test cases
     * @description Handles pending/skipped tests and cleans up suite contexts for the completed file.
     * Ensures all test suites are properly finished in ReportPortal.
     */
    onTestResult(test: Test, testResult: TestResult): void; /**
     * Called when the entire Jest test run completes
     *
     * @returns Promise that resolves when all ReportPortal operations are complete
     * @description Processes all queued async operations and finishes the launch in ReportPortal.
     * Ensures all test data is properly synchronized before the reporter shuts down.
     */
    onRunComplete(): Promise<void>;
    /**
     * Creates and starts test suites in hierarchical order
     *
     * @param suiteTitles - Array of suite names representing the hierarchy (e.g., ["describe1", "describe2"])
     * @param filePath - Absolute path to the test file
     * @param startTime - Timestamp when the suite execution started
     * @description Processes suite hierarchy to create parent-child relationships in ReportPortal.
     * Uses deterministic codeRef generation to ensure consistent test identification across runs.
     */
    private startSuites;
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
    private startSuite;
    /**
     * Starts a test step (individual test case) in ReportPortal
     *
     * @param test - Test case start information including titles and timing
     * @param testPath - Absolute path to the test file
     * @description Creates a test step under the appropriate parent suite with deterministic codeRef.
     * Handles test retries by maintaining an array of temp IDs for the same test.
     */
    private startStep;
    /**
     * Finishes a test step with results and artifacts
     *
     * @param test - Test case result containing status and failure information
     * @param testPath - Absolute path to the test file
     * @description Completes the test step in ReportPortal with final status, error logs, and artifacts.
     * Handles error reporting and artifact attachment for failed tests.
     */
    private finishStep;
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
    sendLog({ saveLogRQ, fileObj, itemTempId }: {
        itemTempId: string;
        saveLogRQ: SaveLogRQ;
        fileObj?: FileObj;
    }): void;
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
    private finishTestStep;
    /**
     * Attaches test artifacts (screenshots and videos) to ReportPortal
     *
     * @param fullName - Full test name used to locate artifact files
     * @param tempStepId - Temporary ID of the test step to attach artifacts to
     * @description Searches for and attaches Detox-generated artifacts (PNG screenshots and MP4 videos)
     * to failed test steps. Uses the configured artifacts path and test naming conventions.
     * Called after suite finishes to ensure Detox has completed writing all files.
     */
    private attachArtifacts;
    /**
     * Finishes a test suite in ReportPortal
     *
     * @param tempTestId - Temporary ID of the suite to finish
     * @param key - Storage key for the suite to clean up
     * @description Completes a test suite in ReportPortal and removes it from local storage.
     * Called when all tests in a suite have completed execution.
     */
    private finishSuite;
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
    private buildCodeReference;
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
    private findArtifactFolder;
    /**
     * Sanitizes filename using the same logic as Detox's sanitize-filename with replacement: '_'
     * This mimics the constructSafeFilename function from Detox
     */
    private sanitizeFilename;
    /**
     * Caches a ReportPortal command for later execution
     */
    private cacheCommand;
}

export { DetoxReporter as default };
