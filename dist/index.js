// src/DetoxReporter.ts
import fs2 from "fs";
import path from "path";
import RPClient from "@reportportal/client-javascript";

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

// src/helper/OfflineMod.ts
import fs from "fs";
function generateReplayScript(cacheFilePath, outputScriptPath = "./rp-replay.js") {
  const replayScript = `#!/usr/bin/env node
/**
 * ReportPortal Replay Script
 * 
 * This script replays cached ReportPortal commands when the service becomes available.
 * Generated automatically by DetoxReporter offline mode.
 * 
 * Usage: node rp-replay.js [cache-file-path]
 */

const fs = require('fs');
const RPClient = require('@reportportal/client-javascript').default;

async function replayCommands(cacheFilePath) {
    try {
        console.log('Loading cached commands from:', cacheFilePath);
        const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
        
        const client = new RPClient(cacheData.reportOptions);
        const commands = cacheData.commands;
        const tempIdMap = new Map(); // Map cached tempIds to real ones
        
        console.log(\`Replaying \${commands.length} commands...\`);
        
        for (const command of commands) {
            console.log(\`Executing: \${command.type} at \${new Date(command.timestamp).toISOString()}\`);
            
            try {
                switch (command.type) {
                    case 'startLaunch': {
                        const { tempId, promise } = client.startLaunch(command.data);
                        await promise;
                        if (command.tempId) {
                            tempIdMap.set(command.tempId, tempId);
                        }
                        break;
                    }
                    
                    case 'startTestItem': {
                        const launchId = command.launchId ? tempIdMap.get(command.launchId) : undefined;
                        const parentId = command.parentId ? tempIdMap.get(command.parentId) : undefined;
                        
                        const { tempId, promise } = client.startTestItem(command.data, launchId, parentId);
                        await promise;
                        if (command.tempId) {
                            tempIdMap.set(command.tempId, tempId);
                        }
                        break;
                    }
                    
                    case 'finishTestItem': {
                        const itemId = command.tempId ? tempIdMap.get(command.tempId) : undefined;
                        if (itemId) {
                            const { promise } = client.finishTestItem(itemId, command.data);
                            await promise;
                        }
                        break;
                    }
                    
                    case 'sendLog': {
                        const itemId = command.tempId ? tempIdMap.get(command.tempId) : undefined;
                        if (itemId) {
                            const { promise } = client.sendLog(itemId, command.data, command.fileData);
                            await promise;
                        }
                        break;
                    }
                    
                    case 'finishLaunch': {
                        const launchId = command.launchId ? tempIdMap.get(command.launchId) : undefined;
                        if (launchId) {
                            const { promise } = client.finishLaunch(launchId, command.data);
                            await promise;
                        }
                        break;
                    }
                }
                
                // Small delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(\`Error executing \${command.type}:\`, error);
                // Continue with next command
            }
        }
        
        console.log('Replay completed successfully!');
        
        // Optionally backup the cache file
        const backupPath = cacheFilePath + '.completed.' + Date.now();
        fs.renameSync(cacheFilePath, backupPath);
        console.log(\`Cache file backed up to: \${backupPath}\`);
        
    } catch (error) {
        console.error('Failed to replay commands:', error);
        process.exit(1);
    }
}

// Main execution
const cacheFile = process.argv[2] || '${cacheFilePath}';
replayCommands(cacheFile);
`;
  try {
    fs.writeFileSync(outputScriptPath, replayScript);
    fs.chmodSync(outputScriptPath, "755");
    console.log(`Replay script generated: ${outputScriptPath}`);
    console.log(`Usage: node ${outputScriptPath} [cache-file-path]`);
  } catch (error) {
    console.error("Failed to generate replay script:", error);
  }
}

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
  cachedCommands;
  cacheFilePath;
  saveToFile;
  constructor(_globalConfig, options) {
    this.reportOptions = {
      apiKey: process.env.RP_API_KEY ?? options.apiKey ?? "",
      artifactsPath: process.env.DETOX_ARTIFACTS_PATH ?? options.artifactsPath,
      cacheFilePath: options.cacheFilePath ?? "./rp-cache.json",
      endpoint: process.env.RP_ENDPOINT ?? options.endpoint ?? "",
      extendTestDescriptionWithLastError: options.extendTestDescriptionWithLastError ?? true,
      launch: process.env.RP_LAUNCH ?? options.launch ?? "",
      project: process.env.RP_PROJECT_NAME ?? options.project ?? "Detox Agent Reporter",
      saveToFile: options.saveToFile ?? false,
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
    this.client = new RPClient(this.reportOptions);
    this.asyncQueue = new AsyncQueue();
    this.storage = new Storage();
    this.cachedCommands = [];
    this.cacheFilePath = this.reportOptions.cacheFilePath ?? "./rp-cache.json";
    this.saveToFile = this.reportOptions.saveToFile ?? false;
  }
  /**
   * Called when Jest test run starts
   *
   * @description Initiates a new launch in ReportPortal with configured attributes and description.
   * Sets up the launch ID in storage for subsequent test items to reference.
   * Always caches commands for replay capability.
   */
  onRunStart() {
    const launchData = {
      attributes: this.reportOptions.attributes ?? [],
      description: this.reportOptions.description ?? "",
      mode: this.reportOptions.mode ?? "DEFAULT",
      startTime: Date.now()
    };
    const { tempId, promise } = this.client.startLaunch(launchData);
    this.storage.setItem("launchId", tempId);
    this.cacheCommand({ data: launchData, tempId, type: "startLaunch" });
    this.asyncQueue.catchAndLogError(promise, "Error starting launch: ");
    this.asyncQueue.enqueue(promise);
  }
  /**
   * Saves cached commands to file if saveToFile option is enabled
   */
  saveCacheToFile() {
    if (!this.saveToFile) {
      return;
    }
    try {
      const cacheData = {
        commands: this.cachedCommands,
        reportOptions: this.reportOptions,
        timestamp: Date.now()
      };
      const cacheDir = path.dirname(this.cacheFilePath);
      if (!fs2.existsSync(cacheDir)) {
        fs2.mkdirSync(cacheDir, { recursive: true });
      }
      fs2.writeFileSync(this.cacheFilePath, JSON.stringify(cacheData, null, 2));
      console.log(`Cached ${this.cachedCommands.length} ReportPortal commands to ${this.cacheFilePath}`);
      if (this.cachedCommands.length > 0) {
        const replayScriptPath = this.cacheFilePath.replace(".json", "-replay.js");
        generateReplayScript(this.cacheFilePath, replayScriptPath);
      }
    } catch (error) {
      console.error("Failed to save cache to file:", error);
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
    this.saveCacheToFile();
    const launchId = this.storage.getItem("launchId");
    this.cacheCommand({ data: { endTime: Date.now() }, launchId, type: "finishLaunch" });
    await this.asyncQueue.process();
    const { promise } = this.client.finishLaunch(launchId, { endTime: Date.now() });
    this.asyncQueue.catchAndLogError(promise, "Error finishing launch: ");
    await promise;
    console.log(`Test run completed. Commands cached in memory ${this.saveToFile ? `and saved to ${this.cacheFilePath}` : ""} for replay capability.`);
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
    const launchId = this.storage.getItem("launchId");
    const testItemData = {
      codeRef,
      name: title,
      startTime,
      type: TEST_ITEM_TYPES.SUITE
    };
    const { tempId, promise } = this.client.startTestItem(testItemData, launchId, parentId);
    this.storage.setItem(suiteKey, tempId);
    this.cacheCommand({
      data: testItemData,
      launchId,
      tempId,
      type: "startTestItem",
      ...parentId && { parentId }
    });
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
    const launchId = this.storage.getItem("launchId");
    const testItemData = {
      codeRef: storedCodeRef,
      name: test.title,
      retry: isRetried,
      startTime: test.startedAt ?? Date.now(),
      type: TEST_ITEM_TYPES.STEP
    };
    let tempIdToStore;
    const { tempId, promise } = this.client.startTestItem(testItemData, launchId, parentId);
    tempIdToStore = [tempId];
    if (isRetried && retryIds) tempIdToStore = retryIds.concat(tempIdToStore);
    this.storage.setItem(stepKey, tempIdToStore);
    this.cacheCommand({
      data: testItemData,
      launchId,
      tempId,
      type: "startTestItem",
      ...parentId && { parentId }
    });
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
    const logData = {
      level: saveLogRQ.level ?? LOG_LEVEL.INFO,
      message: saveLogRQ.message ?? "",
      time: this.client.helpers.now()
    };
    this.cacheCommand({
      data: logData,
      tempId: itemTempId,
      type: "sendLog",
      ...fileObj && {
        fileData: {
          content: fileObj.content,
          name: fileObj.name,
          type: fileObj.type
        }
      }
    });
    const { promise } = this.client.sendLog(itemTempId, logData, fileObj);
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
    const finishData = {
      status,
      ...issue && { issue },
      ...description && { description }
    };
    this.cacheCommand({ data: finishData, tempId: tempStepId, type: "finishTestItem" });
    const { promise } = this.client.finishTestItem(tempStepId, finishData);
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
      const artifactFolder = this.findArtifactFolder(this.reportOptions.artifactsPath, fullName);
      if (artifactFolder) {
        const imagePath = path.join(artifactFolder, "testFnFailure.png");
        if (fs2.existsSync(imagePath)) {
          const image = {
            content: fs2.readFileSync(imagePath).toString("base64"),
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
        const videoPath = path.join(artifactFolder, "test.mp4");
        if (fs2.existsSync(videoPath)) {
          const video = {
            content: fs2.readFileSync(videoPath).toString("base64"),
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
    const finishData = { endTime: Date.now() };
    this.cacheCommand({ data: finishData, tempId: tempTestId, type: "finishTestItem" });
    const { promise } = this.client.finishTestItem(tempTestId, finishData);
    this.asyncQueue.catchAndLogError(promise);
    this.asyncQueue.enqueue(promise);
    this.storage.removeItem(key);
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
    const relativePath = path.relative(process.cwd(), testPath).replace(/\\/g, "/");
    const cleanPath = relativePath.replace(/\.(js|ts|jsx|tsx)$/, "");
    return `${cleanPath}:${hierarchy}`;
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
  findArtifactFolder(root, testFullName) {
    try {
      const prefix = "\u2717 ";
      const sanitizedTestName = this.sanitizeFilename(testFullName);
      const expectedFolderName = `${prefix}${sanitizedTestName}`;
      let expectedPath = path.join(root, expectedFolderName);
      if (fs2.existsSync(expectedPath)) {
        return expectedPath;
      }
      const transformedTestName = testFullName.replace(/^(\w+)\s/, "$1_ ");
      const transformedSanitized = this.sanitizeFilename(transformedTestName);
      const transformedFolderName = `${prefix}${transformedSanitized}`;
      expectedPath = path.join(root, transformedFolderName);
      if (fs2.existsSync(expectedPath)) {
        return expectedPath;
      }
      const entries = fs2.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("\u2717")) {
          return path.join(root, entry.name);
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  /**
   * Sanitizes filename using the same logic as Detox's sanitize-filename with replacement: '_'
   * This mimics the constructSafeFilename function from Detox
   */
  sanitizeFilename(input) {
    return input.replace(/[<>:"/\\|?*]/g, "_").replace(/^\.+$/, "_").replace(/\.$/, "_").trim();
  }
  /**
   * Caches a ReportPortal command for later execution
   */
  cacheCommand(params) {
    const command = {
      data: params.data,
      timestamp: Date.now(),
      type: params.type,
      ...params.tempId && { tempId: params.tempId },
      ...params.launchId && { launchId: params.launchId },
      ...params.parentId && { parentId: params.parentId },
      ...params.fileData && { fileData: params.fileData }
    };
    this.cachedCommands.push(command);
    if (this.saveToFile && (params.type === "startLaunch" || params.type === "finishLaunch" || this.cachedCommands.length % 10 === 0)) {
      this.saveCacheToFile();
    }
  }
};

// src/index.ts
var index_default = DetoxReporter;
export {
  index_default as default
};
