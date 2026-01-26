import fs from 'node:fs'

export interface CachedCommand {
	type: 'startLaunch' | 'startTestItem' | 'finishTestItem' | 'finishLaunch' | 'sendLog'
	timestamp: number
	data: Record<string, unknown>
	tempId?: string
	launchId?: string
	parentId?: string
	fileData?: {
		content?: string // Optional - may be stored externally
		name: string
		type: string
		contentPath?: string // Path to external artifact file
		compressed?: boolean // Whether content is gzip-compressed
	}
}

export default function generateReplayScript(cacheFilePath: string, outputScriptPath = './rp-replay.js'): void {
	// Detect if the current project uses ES modules
	const isESModule = detectESModule()

	const replayScript = generateScript(cacheFilePath, isESModule)

	try {
		fs.writeFileSync(outputScriptPath, replayScript)
		fs.chmodSync(outputScriptPath, '755') // Make executable
	} catch (error) {
		console.error('Failed to generate replay script:', error)
	}
}

function detectESModule(): boolean {
	try {
		// Check if package.json has "type": "module"
		const packageJsonPath = './package.json'
		if (fs.existsSync(packageJsonPath)) {
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
			return packageJson.type === 'module'
		}
	} catch {
		console.warn('Could not detect module type, defaulting to CommonJS')
	}
	return false
}

function generateScript(cacheFilePath: string, isESModule: boolean): string {
	const imports = isESModule
		? `import fs from 'fs';\nimport path from 'path';\nimport { gunzipSync } from 'zlib';\nimport RPClient from '@reportportal/client-javascript';`
		: `const fs = require('fs');\nconst path = require('path');\nconst { gunzipSync } = require('zlib');\nconst RPClient = require('@reportportal/client-javascript').default;`

	const moduleType = isESModule ? 'ES Module' : 'CommonJS'

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
`
}

function getReplayFunction(): string {
	return `async function replayCommands(cacheFilePath) {
    try {
        console.log('Loading cached commands from:', cacheFilePath);
        const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));

        const client = new RPClient(cacheData.reportOptions);
        const commands = cacheData.commands;
        const tempIdMap = new Map(); // Map cached tempIds to real ones
        const cacheDir = path.dirname(cacheFilePath);

        console.log(\`Replaying \${commands.length} commands...\`);

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            console.log(\`[\${i + 1}/\${commands.length}] Executing: \${command.type} at \${new Date(command.timestamp).toISOString()}\`);

            try {
                // Load external artifact if needed
                if (command.fileData?.contentPath) {
                    const artifactPath = path.join(cacheDir, command.fileData.contentPath);
                    if (fs.existsSync(artifactPath)) {
                        let content = fs.readFileSync(artifactPath, 'utf8');
                        
                        // Decompress if compressed
                        if (command.fileData.compressed) {
                            try {
                                const buffer = Buffer.from(content, 'base64');
                                const decompressed = gunzipSync(buffer);
                                content = decompressed.toString('base64');
                            } catch (decompErr) {
                                console.warn('Failed to decompress artifact, using as-is:', decompErr.message);
                            }
                        }
                        
                        command.fileData.content = content;
                        delete command.fileData.contentPath;
                        delete command.fileData.compressed;
                    } else {
                        console.warn(\`Artifact file not found: \${artifactPath}, skipping attachment\`);
                        delete command.fileData;
                    }
                }

                // Add timeout wrapper for all promises
                const timeoutPromise = (promise, timeout = 30000) => {
                    return Promise.race([
                        promise,
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error(\`Timeout after \${timeout}ms\`)), timeout)
                        )
                    ]);
                };

                switch (command.type) {
                    case 'startLaunch': {
                        const { tempId, promise } = client.startLaunch(command.data);
                        await timeoutPromise(promise);
                        if (command.tempId) {
                            tempIdMap.set(command.tempId, tempId);
                        }
                        break;
                    }

                    case 'startTestItem': {
                        const launchId = command.launchId ? tempIdMap.get(command.launchId) : undefined;
                        const parentId = command.parentId ? tempIdMap.get(command.parentId) : undefined;

                        if (command.launchId && !launchId) {
                            throw new Error(\`Launch ID not found in map: \${command.launchId}\`);
                        }
                        if (command.parentId && !parentId) {
                            console.warn(\`Parent ID not found in map: \${command.parentId}, continuing without parent\`);
                        }

                        const { tempId, promise } = client.startTestItem(command.data, launchId, parentId);
                        await timeoutPromise(promise);
                        if (command.tempId) {
                            tempIdMap.set(command.tempId, tempId);
                        }
                        break;
                    }

                    case 'finishTestItem': {
                        const itemId = command.tempId ? tempIdMap.get(command.tempId) : undefined;
                        if (!itemId) {
                            console.warn(\`Test item ID not found in map: \${command.tempId}, skipping finish\`);
                            break;
                        }
                        const { promise } = client.finishTestItem(itemId, command.data);
                        await timeoutPromise(promise);
                        break;
                    }

                    case 'sendLog': {
                        const itemId = command.tempId ? tempIdMap.get(command.tempId) : undefined;
                        if (!itemId) {
                            console.warn(\`Log item ID not found in map: \${command.tempId}, skipping log\`);
                            break;
                        }
                        const { promise } = client.sendLog(itemId, command.data, command.fileData);
                        await timeoutPromise(promise);
                        break;
                    }

                    case 'finishLaunch': {
                        const launchId = command.launchId ? tempIdMap.get(command.launchId) : undefined;
                        if (!launchId) {
                            console.warn(\`Launch ID not found in map: \${command.launchId}, skipping finish launch\`);
                            break;
                        }
                        const { promise } = client.finishLaunch(launchId, command.data);
                        await timeoutPromise(promise);
                        break;
                    }
                }

                successCount++;

                // Adaptive delay: increase after every 30 items to avoid rate limiting
                const delay = i > 0 && (i + 1) % 30 === 0 ? 2000 : 200;
                if (delay === 2000) {
                    console.log(\`Processed 30 items, pausing for \${delay}ms to avoid rate limiting...\`);
                }
                await new Promise(resolve => setTimeout(resolve, delay));

            } catch (error) {
                errorCount++;
                console.error(\`[ERROR \${errorCount}] Failed executing \${command.type}:\`, error.message);

                // If critical command fails (startLaunch), abort
                if (command.type === 'startLaunch') {
                    console.error('Critical error: Failed to start launch. Aborting replay.');
                    throw error;
                }

                // For other errors, continue but warn
                if (errorCount > 10) {
                    console.error(\`Too many errors (\${errorCount}). Consider checking ReportPortal connection.\`);
                }
            }
        }

        console.log(\`\\nReplay summary: \${successCount} succeeded, \${errorCount} failed out of \${commands.length} commands.\`);

        console.log('Replay completed successfully!');

        // Optionally backup the cache file
        const backupPath = cacheFilePath + '.completed.' + Date.now();
        fs.renameSync(cacheFilePath, backupPath);
        console.log(\`Cache file backed up to: \${backupPath}\`);

    } catch (error) {
        console.error('Failed to replay commands:', error);
        process.exit(1);
    }
}`
}
