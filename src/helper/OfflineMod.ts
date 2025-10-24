import fs from 'node:fs'

export interface CachedCommand {
	type: 'startLaunch' | 'startTestItem' | 'finishTestItem' | 'finishLaunch' | 'sendLog'
	timestamp: number
	data: Record<string, unknown>
	tempId?: string
	launchId?: string
	parentId?: string
	fileData?: {
		content: string
		name: string
		type: string
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
		? `import fs from 'fs';\nimport RPClient from '@reportportal/client-javascript';`
		: `const fs = require('fs');\nconst RPClient = require('@reportportal/client-javascript').default;`

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
}`
}
