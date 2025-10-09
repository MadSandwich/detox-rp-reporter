"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// src/DetoxReporter.ts
var import_node_fs = __toESM(require("fs"), 1);
var import_node_path = __toESM(require("path"), 1);
var import_client_javascript = __toESM(require("@reportportal/client-javascript"), 1);

// src/AsyncQueue.ts
var AsyncQueue = class {
  queue;
  constructor() {
    this.queue = [];
  }
  enqueue(promise) {
    this.queue.push(promise);
  }
  catchAndLogError(promise, customMessage) {
    promise.catch((error) => {
      console.error(customMessage || "Error in AsyncQueue:", error);
    });
  }
  async process() {
    return Promise.all(this.queue);
  }
};

// src/Storage.ts
var Storage = class {
  storage;
  constructor() {
    this.storage = {};
  }
  getItem(key) {
    return this.storage[key];
  }
  getAllKeys() {
    return Object.keys(this.storage);
  }
  setItem(key, value) {
    this.storage[key] = value;
  }
  removeItem(key) {
    delete this.storage[key];
  }
  clear() {
    this.storage = {};
  }
};

// src/DetoxReporter.ts
var LOG_LEVEL = {
  DEBUG: "debug",
  ERROR: "error",
  INFO: "info",
  TRACE: "trace",
  WARN: "warn"
};
var TEST_ITEM_TYPES = {
  STEP: "STEP",
  SUITE: "SUITE"
};
var DetoxReporter = class {
  reportOptions;
  client;
  asyncQueue;
  storage;
  constructor(_globalConfig, options) {
    this.reportOptions = {
      apiKey: process.env.RP_API_KEY ?? options.apiKey ?? "",
      artifactsPath: process.env.DETOX_ARTIFACTS_PATH ?? options.artifactsPath,
      endpoint: process.env.RP_ENDPOINT ?? options.endpoint ?? "",
      extendTestDescriptionWithLastError: options.extendTestDescriptionWithLastError ?? true,
      launch: process.env.RP_LAUNCH ?? options.launch ?? "",
      project: process.env.RP_PROJECT_NAME ?? options.project ?? "Detox Agent Reporter",
      ...options.attributes && { attributes: options.attributes },
      ...options.debug !== void 0 && { debug: options.debug },
      ...options.description && { description: process.env.RP_DESCRIPTION ?? options.description },
      ...options.isLaunchMergeRequired !== void 0 && { isLaunchMergeRequired: options.isLaunchMergeRequired },
      ...options.launchUuidPrint !== void 0 && { launchUuidPrint: options.launchUuidPrint },
      ...options.launchUuidPrintOutput && { launchUuidPrintOutput: options.launchUuidPrintOutput },
      ...options.mode && { mode: process.env.RP_MODE || options.mode },
      ...options.restClientConfig && { restClientConfig: options.restClientConfig },
      ...options.skippedIssue !== void 0 && { skippedIssue: options.skippedIssue }
    };
    this.client = new import_client_javascript.default(this.reportOptions);
    this.asyncQueue = new AsyncQueue();
    this.storage = new Storage();
  }
  /**
   * Called when Jest test run starts
   *
   * @description Initiates a new launch in ReportPortal with configured attributes and description.
   * Sets up the launch ID in storage for subsequent test items to reference.
   */
  onRunStart() {
    const { tempId, promise } = this.client.startLaunch({
      attributes: this.reportOptions.attributes ?? [],
      description: this.reportOptions.description ?? "",
      mode: this.reportOptions.mode ?? "DEFAULT",
      startTime: Date.now()
    });
    this.storage.setItem("launchId", tempId);
    this.asyncQueue.catchAndLogError(promise, "Error starting launch: ");
    this.asyncQueue.enqueue(promise);
  }
  /**
   * Called when a test case starts execution
   *
   * @param test - Jest test object containing file path and metadata
   * @param testCaseStartInfo - Test case start information including ancestor titles and timing
   * @description Initiates the test suite hierarchy and starts the individual test step in ReportPortal.
   * Creates necessary parent suites if they don't exist and establishes the test structure.
   */
  onTestCaseStart(test, testCaseStartInfo) {
    this.startSuites(testCaseStartInfo.ancestorTitles, test.path, testCaseStartInfo.startedAt ?? Date.now());
    this.startStep(testCaseStartInfo, test.path);
  }
  /**
   * Called when a test case completes execution
   *
   * @param test - Jest test object containing file path and metadata
   * @param testCaseResult - Test case result information including status and failure details
   * @description Finishes the test step in ReportPortal with the final status and any error information.
   * Handles attachment of artifacts if the test failed.
   */
  onTestCaseResult(test, testCaseResult) {
    this.finishStep(testCaseResult, test.path);
  }
  /**
   * Called when a test file completes execution
   *
   * @param test - Jest test object containing file path and metadata
   * @param testResult - Complete test file results including all test cases
   * @description Handles pending/skipped tests and cleans up suite contexts for the completed file.
   * Ensures all test suites are properly finished in ReportPortal.
   */
  onTestResult(test, testResult) {
    testResult.testResults.forEach((result) => {
      if (result.status === "pending") {
        const testCaseWithStartTime = {
          ancestorTitles: result.ancestorTitles,
          failureDetails: result.failureDetails,
          failureMessages: result.failureMessages,
          fullName: result.fullName,
          mode: "skip",
          numPassingAsserts: result.numPassingAsserts,
          startedAt: result.startedAt ?? Date.now(),
          status: result.status,
          title: result.title
        };
        this.startSuites(result.ancestorTitles, test.path, testCaseWithStartTime.startedAt);
        this.startStep(testCaseWithStartTime, test.path);
        this.finishStep(testCaseWithStartTime, test.path);
      }
    });
    const storageKeys = this.storage.getAllKeys();
    for (const key of storageKeys) {
      if (key.startsWith("suiteContext_") && key.includes(testResult.testFilePath)) {
        const codeRef = this.storage.getItem(key);
        if (codeRef) {
          const suiteKey = `suite_${codeRef}`;
          const suiteTempId = this.storage.getItem(suiteKey);
          if (suiteTempId) this.finishSuite(suiteTempId, suiteKey);
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
  async onRunComplete() {
    await this.asyncQueue.process();
    const { promise } = this.client.finishLaunch(this.storage.getItem("launchId"), { endTime: Date.now() });
    this.asyncQueue.catchAndLogError(promise, "Error finishing launch: ");
    await promise;
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
  startSuites(suiteTitles, filePath, startTime) {
    let currentSuitePath = "";
    let parentCodeRef = "";
    for (const suiteTitle of suiteTitles) {
      const fullSuiteName = currentSuitePath ? `${currentSuitePath}/${suiteTitle}` : suiteTitle;
      const suiteContextKey = `${filePath}:${fullSuiteName}`;
      const codeRef = this.buildCodeReference(filePath, fullSuiteName);
      let storedCodeRef = this.storage.getItem(`suiteContext_${suiteContextKey}`);
      if (!storedCodeRef) {
        storedCodeRef = codeRef;
        this.storage.setItem(`suiteContext_${suiteContextKey}`, storedCodeRef);
      }
      this.startSuite(suiteTitle, storedCodeRef, parentCodeRef, startTime);
      parentCodeRef = storedCodeRef;
      currentSuitePath = fullSuiteName;
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
  startSuite(title, codeRef, parentCodeRef = "", startTime = Date.now()) {
    const suiteKey = `suite_${codeRef}`;
    if (this.storage.getItem(suiteKey)) {
      return;
    }
    const parentKey = `suite_${parentCodeRef}`;
    const parentId = parentCodeRef ? this.storage.getItem(parentKey) : void 0;
    const { tempId, promise } = this.client.startTestItem(
      {
        codeRef,
        name: title,
        startTime,
        type: TEST_ITEM_TYPES.SUITE
      },
      this.storage.getItem("launchId"),
      parentId
    );
    this.storage.setItem(suiteKey, tempId);
    this.asyncQueue.catchAndLogError(promise);
    this.asyncQueue.enqueue(promise);
  }
  /**
   * Starts a test step (individual test case) in ReportPortal
   *
   * @param test - Test case start information including titles and timing
   * @param testPath - Absolute path to the test file
   * @description Creates a test step under the appropriate parent suite with deterministic codeRef.
   * Handles test retries by maintaining an array of temp IDs for the same test.
   */
  startStep(test, testPath) {
    const fullStepName = `${test.ancestorTitles.join("/")}/${test.title}`;
    const stepContextKey = `${testPath}:${fullStepName}`;
    const codeRef = this.buildCodeReference(testPath, fullStepName);
    let storedCodeRef = this.storage.getItem(`stepContext_${stepContextKey}`);
    if (!storedCodeRef) {
      storedCodeRef = codeRef;
      this.storage.setItem(`stepContext_${stepContextKey}`, storedCodeRef);
    }
    const stepKey = `step_${storedCodeRef}`;
    const retryIds = this.storage.getItem(stepKey);
    const isRetried = !!retryIds;
    const parentSuiteContextKey = `${testPath}:${test.ancestorTitles.join("/")}`;
    const parentCodeRef = this.storage.getItem(`suiteContext_${parentSuiteContextKey}`);
    const parentKey = `suite_${parentCodeRef}`;
    const parentId = parentCodeRef ? this.storage.getItem(parentKey) : void 0;
    const { tempId, promise } = this.client.startTestItem(
      {
        codeRef: storedCodeRef,
        name: test.title,
        retry: isRetried,
        startTime: test.startedAt ?? Date.now(),
        type: TEST_ITEM_TYPES.STEP
      },
      this.storage.getItem("launchId"),
      parentId
    );
    let tempIdToStore = [tempId];
    if (isRetried) tempIdToStore = retryIds.concat(tempIdToStore);
    this.storage.setItem(stepKey, tempIdToStore);
    this.asyncQueue.catchAndLogError(promise);
    this.asyncQueue.enqueue(promise);
  }
  /**
   * Finishes a test step with results and artifacts
   *
   * @param test - Test case result containing status and failure information
   * @param testPath - Absolute path to the test file
   * @description Completes the test step in ReportPortal with final status, error logs, and artifacts.
   * Handles error reporting and artifact attachment for failed tests.
   */
  finishStep(test, testPath) {
    const fullName = `${test.ancestorTitles.join("/")}/${test.title}`;
    const stepContextKey = `${testPath}:${fullName}`;
    const codeRef = this.storage.getItem(`stepContext_${stepContextKey}`);
    if (!codeRef) {
      process.stderr.write(`Could not finish Test Step - step context not found for "${stepContextKey}"`);
      return;
    }
    const stepKey = `step_${codeRef}`;
    const tempStepIds = this.storage.getItem(stepKey);
    const tempStepId = Array.isArray(tempStepIds) ? tempStepIds.shift() : void 0;
    if (tempStepIds && tempStepId) this.storage.setItem(stepKey, tempStepIds);
    if (!tempStepId) {
      process.stderr.write(`Could not finish Test Step - "${codeRef}". tempId not found
`);
      return;
    }
    const errorMsg = test.failureMessages?.[0] ?? "";
    const testName = test.fullName;
    const testStatus = test.status === "pending" ? "skipped" : test.status ?? "skipped";
    this.finishTestStep({ error: errorMsg, fullName: testName, status: testStatus, tempStepId });
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
  sendLog({ saveLogRQ, fileObj, itemTempId }) {
    const { promise } = this.client.sendLog(
      itemTempId,
      {
        level: saveLogRQ.level ?? LOG_LEVEL.INFO,
        message: saveLogRQ.message ?? "",
        time: this.client.helpers.now()
      },
      fileObj
    );
    this.asyncQueue.catchAndLogError(promise);
    this.asyncQueue.enqueue(promise);
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
  finishTestStep({ error, fullName, tempStepId, status }) {
    const issue = this.reportOptions.skippedIssue === false ? { issueType: "NOT_ISSUE" } : void 0;
    const description = this.reportOptions.extendTestDescriptionWithLastError === false ? void 0 : `\`\`\`error
${error}
\`\`\``;
    if (error) {
      this.sendLog({
        itemTempId: tempStepId,
        saveLogRQ: {
          level: LOG_LEVEL.ERROR,
          message: error
        }
      });
    }
    fullName && this.attachArtifacts(fullName, tempStepId);
    const { promise } = this.client.finishTestItem(tempStepId, {
      status,
      ...issue && { issue },
      ...description && { description }
    });
    this.asyncQueue.catchAndLogError(promise);
    this.asyncQueue.enqueue(promise);
  }
  /**
   * Attaches test artifacts (screenshots and videos) to ReportPortal
   *
   * @param fullName - Full test name used to locate artifact files
   * @param tempStepId - Temporary ID of the test step to attach artifacts to
   * @description Searches for and attaches Detox-generated artifacts (PNG screenshots and MP4 videos)
   * to failed test steps. Uses the configured artifacts path and test naming conventions.
   */
  attachArtifacts(fullName, tempStepId) {
    if (this.reportOptions.artifactsPath) {
      const imagePath = this.retrieveFilePath(this.reportOptions.artifactsPath, fullName, "testFnFailure.png");
      const videoPath = this.retrieveFilePath(this.reportOptions.artifactsPath, fullName, "test.mp4");
      if (imagePath) {
        const image = {
          content: import_node_fs.default.readFileSync(imagePath).toString("base64"),
          name: "testFnFailure.png",
          type: "image/png"
        };
        this.sendLog({
          fileObj: image,
          itemTempId: tempStepId,
          saveLogRQ: {
            level: LOG_LEVEL.ERROR,
            message: "Screenshot:"
          }
        });
      }
      if (videoPath) {
        const video = {
          content: import_node_fs.default.readFileSync(videoPath).toString("base64"),
          name: "test.mp4",
          type: "video/mp4"
        };
        this.sendLog({
          fileObj: video,
          itemTempId: tempStepId,
          saveLogRQ: {
            level: LOG_LEVEL.ERROR,
            message: "Video:"
          }
        });
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
  finishSuite(tempTestId, key) {
    if (!tempTestId) {
      return;
    }
    const { promise } = this.client.finishTestItem(tempTestId, { endTime: Date.now() });
    this.storage.removeItem(key);
    this.asyncQueue.catchAndLogError(promise);
    this.asyncQueue.enqueue(promise);
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
  buildCodeReference(testPath, hierarchy) {
    const relativePath = import_node_path.default.relative(process.cwd(), testPath).replace(/\\/g, "/");
    const cleanPath = relativePath.replace(/\.(js|ts|jsx|tsx)$/, "");
    return `${cleanPath}:${hierarchy}`;
  }
  /**
   * Recursively searches for test artifact files in the Detox artifacts directory
   *
   * @param root - Root artifacts directory path to search in
   * @param testFullName - Full test name including suite hierarchy
   * @param fileName - Specific file name to locate (e.g., 'testFnFailure.png', 'test.mp4')
   * @returns Full path to the artifact file if found, null otherwise
   * @description Implements intelligent artifact discovery using Detox naming conventions.
   * Searches for folders matching the test failure pattern and locates specific artifact files.
   * Handles various folder naming patterns and recursively searches subdirectories.
   */
  retrieveFilePath(root, testFullName, fileName) {
    const parts = testFullName.split(" ");
    const testName = parts[parts.length - 1];
    const suiteParts = parts.slice(0, -1);
    const suiteNameConverted = suiteParts.join(" ").replace(/:\s*/g, "_ ");
    const expectedFolderName = `\u2717 ${suiteNameConverted} ${testName}`;
    const searchRecursively = (dir, depth = 0) => {
      if (depth > 5) {
        return null;
      }
      try {
        const entries = import_node_fs.default.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name === expectedFolderName) {
            const candidatePath = import_node_path.default.join(dir, entry.name, fileName);
            if (import_node_fs.default.existsSync(candidatePath)) {
              return candidatePath;
            }
          }
        }
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.includes("\u2717") && entry.name.includes(testName)) {
            const candidatePath = import_node_path.default.join(dir, entry.name, fileName);
            if (import_node_fs.default.existsSync(candidatePath)) {
              return candidatePath;
            }
          }
        }
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const fullPath = import_node_path.default.join(dir, entry.name);
            const result = searchRecursively(fullPath, depth + 1);
            if (result) {
              return result;
            }
          }
        }
      } catch (error) {
        console.error(`[findFile] Error reading directory ${dir}:`, error);
      }
      return null;
    };
    return searchRecursively(root);
  }
};

// src/index.ts
var index_default = DetoxReporter;
