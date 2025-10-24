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
var import_node_fs2 = __toESM(require("fs"), 1);
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

// src/helper/OfflineMod.ts
var import_node_fs = __toESM(require("fs"), 1);
function generateReplayScript(cacheFilePath, outputScriptPath = "./rp-replay.js") {
  const isESModule = detectESModule();
  const replayScript = generateScript(cacheFilePath, isESModule);
  try {
    import_node_fs.default.writeFileSync(outputScriptPath, replayScript);
    import_node_fs.default.chmodSync(outputScriptPath, "755");
    console.log(`Replay script generated: ${outputScriptPath} (${isESModule ? "ES Module" : "CommonJS"})`);
    console.log(`Usage: node ${outputScriptPath} [cache-file-path]`);
  } catch (error) {
    console.error("Failed to generate replay script:", error);
  }
}
function detectESModule() {
  try {
    const packageJsonPath = "./package.json";
    if (import_node_fs.default.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(import_node_fs.default.readFileSync(packageJsonPath, "utf8"));
      return packageJson.type === "module";
    }
  } catch {
    console.warn("Could not detect module type, defaulting to CommonJS");
  }
  return false;
}
function generateScript(cacheFilePath, isESModule) {
  const imports = isESModule ? `import fs from 'fs';
import RPClient from '@reportportal/client-javascript';` : `const fs = require('fs');
const RPClient = require('@reportportal/client-javascript').default;`;
  const moduleType = isESModule ? "ES Module" : "CommonJS";
  return `#!/usr/bin/env node
/**
 * ReportPortal Replay Script (${moduleType})
 * 
 * This script replays cached ReportPortal commands when the service becomes available.
 * Generated automatically by DetoxReporter offline mode.
 * 
 * Usage: node rp-replay.js [cache-file-path]
 */

${imports}

${getReplayFunction()}

// Main execution
const cacheFile = process.argv[2] || '${cacheFilePath}';
replayCommands(cacheFile);
`;
}
function getReplayFunction() {
  return `async function replayCommands(cacheFilePath) {
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
}`;
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
  failedTests;
  constructor(_globalConfig, options) {
    this.reportOptions = {
      apiKey: process.env.RP_API_KEY ?? options.apiKey ?? "",
      artifactsPath: process.env.DETOX_ARTIFACTS_PATH ?? ".artifacts",
      cacheFilePath: options.cacheFilePath ?? "./rp-cache.json",
      endpoint: process.env.RP_ENDPOINT ?? options.endpoint ?? "",
      extendTestDescriptionWithLastError: options.extendTestDescriptionWithLastError ?? true,
      launch: process.env.RP_LAUNCH ?? options.launch ?? "",
      offlineMode: options.offlineMode ?? false,
      project: process.env.RP_PROJECT_NAME ?? options.project ?? "Detox Agent Reporter",
      saveToFile: options.saveToFile ?? true,
      ...options.attributes && { attributes: options.attributes },
      ...options.debug !== void 0 && { debug: options.debug },
      ...options.description && { description: process.env.RP_DESCRIPTION ?? options.description },
      ...options.isLaunchMergeRequired !== void 0 && { isLaunchMergeRequired: options.isLaunchMergeRequired },
      ...options.launchUuidPrint !== void 0 && { launchUuidPrint: options.launchUuidPrint },
      ...options.launchUuidPrintOutput && { launchUuidPrintOutput: options.launchUuidPrintOutput },
      ...options.mode && { mode: process.env.RP_MODE || options.mode },
      ...options.restClientConfig && {
        restClientConfig: {
          ...options.restClientConfig,
          // Enable debug logging to see actual API calls
          debug: options.restClientConfig.debug ?? options.debug ?? false
        }
      },
      ...options.skippedIssue !== void 0 && { skippedIssue: options.skippedIssue }
    };
    this.client = new import_client_javascript.default(this.reportOptions);
    this.asyncQueue = new AsyncQueue();
    this.storage = new Storage();
    this.cachedCommands = [];
    this.failedTests = /* @__PURE__ */ new Map();
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
  onRunStart() {
    const launchData = {
      attributes: this.reportOptions.attributes ?? [],
      description: this.reportOptions.description ?? "",
      mode: this.reportOptions.mode ?? "DEFAULT",
      startTime: Date.now()
    };
    let tempId;
    if (this.reportOptions.offlineMode) {
      tempId = `offline-launch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    } else {
      const { tempId: rpTempId, promise } = this.client.startLaunch(launchData);
      tempId = rpTempId;
      this.asyncQueue.catchAndLogError(promise, "Error starting launch: ");
      this.asyncQueue.enqueue(promise);
    }
    this.storage.setItem("launchId", tempId);
    this.cacheCommand({ data: launchData, tempId, type: "startLaunch" });
  }
  /**
   * Saves cached commands to file if saveToFile option is enabled
   */
  saveCacheToFile() {
    if (!this.reportOptions.saveToFile || !this.reportOptions.cacheFilePath) {
      return;
    }
    try {
      const cacheData = {
        commands: this.cachedCommands,
        reportOptions: this.reportOptions,
        timestamp: Date.now()
      };
      const cacheDir = import_node_path.default.dirname(this.reportOptions.cacheFilePath);
      if (!import_node_fs2.default.existsSync(cacheDir)) {
        import_node_fs2.default.mkdirSync(cacheDir, { recursive: true });
      }
      import_node_fs2.default.writeFileSync(this.reportOptions.cacheFilePath, JSON.stringify(cacheData, null, 2));
      if (this.cachedCommands.length > 0) {
        const replayScriptPath = this.reportOptions.cacheFilePath.replace(".json", "-replay.js");
        generateReplayScript(this.reportOptions.cacheFilePath, replayScriptPath);
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
    for (const [fullName, testInfo] of this.failedTests.entries()) {
      if (test.path === testResult.testFilePath) {
        this.attachArtifacts(fullName, testInfo.tempStepId);
        const finishData = {
          status: "failed",
          ...testInfo.issue && { issue: testInfo.issue },
          ...testInfo.description && { description: testInfo.description }
        };
        this.cacheCommand({ data: finishData, tempId: testInfo.tempStepId, type: "finishTestItem" });
        if (!this.reportOptions.offlineMode) {
          const { promise } = this.client.finishTestItem(testInfo.tempStepId, finishData);
          this.asyncQueue.catchAndLogError(promise);
          this.asyncQueue.enqueue(promise);
        }
        this.failedTests.delete(fullName);
      }
    }
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
    if (this.reportOptions.offlineMode) {
      if (this.cachedCommands.length > 0) {
        this.reportOptions.cacheFilePath?.replace(".json", "-replay.js") ?? "./rp-replay.js";
      }
      return;
    }
    await this.asyncQueue.process();
    const { promise } = this.client.finishLaunch(launchId, { endTime: Date.now() });
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
    const launchId = this.storage.getItem("launchId");
    const testItemData = {
      codeRef,
      name: title,
      startTime,
      type: TEST_ITEM_TYPES.SUITE
    };
    let tempId;
    if (this.reportOptions.offlineMode) {
      tempId = `offline-suite-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    } else {
      const { tempId: rpTempId, promise } = this.client.startTestItem(testItemData, launchId, parentId);
      tempId = rpTempId;
      this.asyncQueue.catchAndLogError(promise);
      this.asyncQueue.enqueue(promise);
    }
    this.storage.setItem(suiteKey, tempId);
    this.cacheCommand({
      data: testItemData,
      launchId,
      tempId,
      type: "startTestItem",
      ...parentId && { parentId }
    });
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
    let tempId;
    let tempIdToStore;
    if (this.reportOptions.offlineMode) {
      tempId = `offline-step-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    } else {
      const { tempId: rpTempId, promise } = this.client.startTestItem(testItemData, launchId, parentId);
      tempId = rpTempId;
      this.asyncQueue.catchAndLogError(promise);
      this.asyncQueue.enqueue(promise);
    }
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
    if (!this.reportOptions.offlineMode) {
      const { promise } = this.client.sendLog(itemTempId, logData, fileObj);
      this.asyncQueue.catchAndLogError(promise);
      this.asyncQueue.enqueue(promise);
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
    if (fullName && status === "failed") {
      this.failedTests.set(fullName, {
        fullName,
        tempStepId,
        ...error && { error },
        ...issue && { issue },
        ...description && { description }
      });
      return;
    }
    const finishData = {
      status,
      ...issue && { issue },
      ...description && { description }
    };
    this.cacheCommand({ data: finishData, tempId: tempStepId, type: "finishTestItem" });
    if (!this.reportOptions.offlineMode) {
      const { promise } = this.client.finishTestItem(tempStepId, finishData);
      this.asyncQueue.catchAndLogError(promise);
      this.asyncQueue.enqueue(promise);
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
  attachArtifacts(fullName, tempStepId) {
    if (this.reportOptions.artifactsPath) {
      const artifactFolder = this.findArtifactFolder(this.reportOptions.artifactsPath, fullName);
      if (artifactFolder) {
        try {
          const files = import_node_fs2.default.readdirSync(artifactFolder);
          const pngFiles = files.filter((file) => import_node_path.default.extname(file).toLowerCase() === ".png");
          for (const pngFile of pngFiles) {
            const imagePath = import_node_path.default.join(artifactFolder, pngFile);
            if (import_node_fs2.default.existsSync(imagePath)) {
              const fileNameWithoutExt = import_node_path.default.basename(pngFile, import_node_path.default.extname(pngFile));
              const imageBuffer = import_node_fs2.default.readFileSync(imagePath);
              const image = {
                content: imageBuffer.toString("base64"),
                name: pngFile,
                type: "image/png"
              };
              this.sendLog({
                fileObj: image,
                itemTempId: tempStepId,
                saveLogRQ: {
                  level: LOG_LEVEL.ERROR,
                  message: fileNameWithoutExt
                }
              });
            }
          }
        } catch (error) {
          console.warn(`Failed to read PNG files from artifact folder: ${artifactFolder}`, error);
        }
        try {
          const files = import_node_fs2.default.readdirSync(artifactFolder);
          const mp4Files = files.filter((file) => import_node_path.default.extname(file).toLowerCase() === ".mp4");
          for (const mp4File of mp4Files) {
            const videoPath = import_node_path.default.join(artifactFolder, mp4File);
            if (import_node_fs2.default.existsSync(videoPath)) {
              const fileNameWithoutExt = import_node_path.default.basename(mp4File, import_node_path.default.extname(mp4File));
              const videoBuffer = import_node_fs2.default.readFileSync(videoPath);
              const video = {
                content: videoBuffer.toString("base64"),
                name: mp4File,
                type: "video/mp4"
              };
              this.sendLog({
                fileObj: video,
                itemTempId: tempStepId,
                saveLogRQ: {
                  level: LOG_LEVEL.ERROR,
                  message: fileNameWithoutExt
                }
              });
            } else {
              console.warn(`[DetoxReporter] Video file does not exist: ${videoPath}`);
            }
          }
        } catch (error) {
          console.warn(`Failed to read MP4 files from artifact folder: ${artifactFolder}`, error);
        }
        try {
          const parentFolder = import_node_path.default.dirname(artifactFolder);
          if (import_node_fs2.default.existsSync(parentFolder)) {
            const parentFiles = import_node_fs2.default.readdirSync(parentFolder);
            const parentMp4Files = parentFiles.filter((file) => import_node_path.default.extname(file).toLowerCase() === ".mp4");
            for (const mp4File of parentMp4Files) {
              const videoPath = import_node_path.default.join(parentFolder, mp4File);
              if (import_node_fs2.default.existsSync(videoPath)) {
                const fileNameWithoutExt = import_node_path.default.basename(mp4File, import_node_path.default.extname(mp4File));
                const videoBuffer = import_node_fs2.default.readFileSync(videoPath);
                const video = {
                  content: videoBuffer.toString("base64"),
                  name: mp4File,
                  type: "video/mp4"
                };
                this.sendLog({
                  fileObj: video,
                  itemTempId: tempStepId,
                  saveLogRQ: {
                    level: LOG_LEVEL.ERROR,
                    message: fileNameWithoutExt
                  }
                });
              }
            }
          }
        } catch (error) {
          console.warn(`Failed to read MP4 files from parent folder`, error);
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
    if (!this.reportOptions.offlineMode) {
      const { promise } = this.client.finishTestItem(tempTestId, finishData);
      this.asyncQueue.catchAndLogError(promise);
      this.asyncQueue.enqueue(promise);
    }
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
    const relativePath = import_node_path.default.relative(process.cwd(), testPath).replace(/\\/g, "/");
    const cleanPath = relativePath.replace(/\.(js|ts|jsx|tsx)$/, "");
    return `${cleanPath}:${hierarchy}`;
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
  findArtifactFolder(root, testFullName) {
    try {
      const prefix = "\u2717 ";
      const sanitizedTestName = this.sanitizeFilename(testFullName);
      const expectedFolderName = `${prefix}${sanitizedTestName}`;
      const transformedTestName = testFullName.replace(/^(\w+)\s/, "$1_ ");
      const transformedSanitized = this.sanitizeFilename(transformedTestName);
      const transformedFolderName = `${prefix}${transformedSanitized}`;
      let directPath = import_node_path.default.join(root, expectedFolderName);
      if (import_node_fs2.default.existsSync(directPath)) {
        return directPath;
      }
      directPath = import_node_path.default.join(root, transformedFolderName);
      if (import_node_fs2.default.existsSync(directPath)) {
        return directPath;
      }
      const entries = import_node_fs2.default.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith("\u2717")) {
          continue;
        }
        const sessionPath = import_node_path.default.join(root, entry.name);
        let sessionArtifactPath = import_node_path.default.join(sessionPath, expectedFolderName);
        if (import_node_fs2.default.existsSync(sessionArtifactPath)) {
          return sessionArtifactPath;
        }
        sessionArtifactPath = import_node_path.default.join(sessionPath, transformedFolderName);
        if (import_node_fs2.default.existsSync(sessionArtifactPath)) {
          return sessionArtifactPath;
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
    if (this.reportOptions.saveToFile) {
      const shouldSave = this.reportOptions.offlineMode || params.type === "startLaunch" || params.type === "finishLaunch" || this.cachedCommands.length % 10 === 0;
      if (shouldSave) {
        this.saveCacheToFile();
      }
    }
  }
};

// src/index.ts
var index_default = DetoxReporter;
