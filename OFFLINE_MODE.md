# Detox ReportPortal Reporter - Always-Cache Mode

The Detox ReportPortal Reporter operates in **always-cache mode**, meaning it caches all commands in memory for replay capability. Commands are always sent to ReportPortal, but can optionally be saved to a file for persistence.

## How It Works

### Always-Cache Behavior

- **Memory Caching**: All commands are cached in memory during test execution
- **ReportPortal Integration**: Commands are always sent to ReportPortal in real-time
- **Optional File Saving**: Commands can be saved to file when `saveToFile: true` option is set

### Automatic Resilience

1. **Network Issues**: If ReportPortal becomes unavailable mid-test, cached commands can be replayed later
2. **Backup Strategy**: All test data is preserved in memory for replay/debugging
3. **Optional Persistence**: Save to file only when explicitly configured

## Usage Modes

### Standard Mode (Default)

```bash
# Run tests normally - commands are sent to ReportPortal and cached in memory
npx detox test
```

- Tests are reported to ReportPortal in real-time
- All commands are cached in memory for replay capability
- No files are created unless explicitly configured

### File Saving Mode

```typescript
// jest.config.js
module.exports = {
  reporters: [
    ['detox-rp-reporter', {
      saveToFile: true,
      cacheFilePath: './my-cache.json' // optional, defaults to './rp-cache.json'
    }]
  ]
}
```

- Commands are sent to ReportPortal AND saved to file
- Cache file persists for later replay
- Replay script is generated automatically

## Cache File Structure

When `saveToFile: true` is enabled, the cache file contains:

```json
{
  "commands": [
    {
      "type": "startLaunch",
      "timestamp": 1234567890123,
      "data": { "name": "Test Launch", "startTime": 1234567890123 },
      "tempId": "launch_abc123"
    },
    {
      "type": "startTestItem",
      "timestamp": 1234567890124,
      "data": { "name": "Test Suite", "type": "SUITE" },
      "tempId": "suite_def456",
      "launchId": "launch_abc123"
    }
  ],
  "reportOptions": { /* reporter configuration */ },
  "timestamp": 1234567890123
}
```

## Replay Utility

When cache files are created, a replay script is automatically generated:

```bash
# Auto-generated replay script
node my-cache-replay.js
```

## Benefits

- **Zero Configuration**: Always caches in memory without setup
- **Optional Persistence**: Save to file only when needed
- **Full Resilience**: Never lose test data
- **Seamless Integration**: Always reports to ReportPortal when available
