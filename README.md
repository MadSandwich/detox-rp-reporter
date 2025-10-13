# detox-rp-reporter

[![npm version](https://img.shields.io/npm/v/detox-rp-reporter.svg)](https://www.npmjs.com/package/detox-rp-reporter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

A Jest reporter that integrates Detox mobile testing framework with ReportPortal for comprehensive test reporting and analytics.

## Features

* **ReportPortal Integration**: Uploads test results directly to ReportPortal
* **Artifact Support**: Automatically attaches screenshots and videos from failed tests
* **Always-Cache Mode**: Commands cached in memory for reliable reporting
* **TypeScript Support**: Built with TypeScript for better developer experience

## Installation

```bash
yarn add -D detox-rp-reporter
# or
npm install --save-dev detox-rp-reporter
```

## Configuration

### Environment Variables

```bash
export RP_ENDPOINT=https://your-reportportal-instance.com
export RP_API_KEY=your-api-key
export RP_PROJECT_NAME=your-project-name
export RP_LAUNCH=your-launch-name
export DETOX_ARTIFACTS_PATH=.artifacts
```

### Jest Configuration

```javascript
module.exports = {
  reporters: [
    'default',
    ['detox-rp-reporter', {
      endpoint: process.env.RP_ENDPOINT,
      apiKey: process.env.RP_API_KEY,
      project: process.env.RP_PROJECT_NAME,
      launch: process.env.RP_LAUNCH,
      artifactsPath: process.env.DETOX_ARTIFACTS_PATH,
      attributes: [
        { key: 'framework', value: 'detox' },
        { key: 'platform', value: 'mobile' }
      ]
    }]
  ]
};
```

## Usage

Once configured, the reporter automatically:

* Creates a launch in ReportPortal when Jest starts
* Tracks test execution and creates test items
* Attaches screenshots and videos from failed tests
* Completes the launch when all tests finish

### Artifact Handling

The reporter automatically searches for and attaches artifacts from failed tests:

* **Screenshots**: `testFnFailure.png` from failed test artifacts
* **Videos**: `test.mp4` from failed test recordings

Artifacts are searched in the Detox artifacts directory structure:

```text
.artifacts/
└── ✗ Login Screen should login with valid credentials/
    ├── testFnFailure.png
    └── test.mp4
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | string | - | ReportPortal endpoint URL |
| `apiKey` | string | - | ReportPortal API key |
| `project` | string | - | ReportPortal project name |
| `launch` | string | - | Launch name |
| `description` | string | - | Launch description |
| `mode` | string | `DEFAULT` | Launch mode |
| `artifactsPath` | string | `.artifacts` | Path to Detox artifacts |
| `attributes` | array | `[]` | Launch attributes |
| `extendTestDescriptionWithLastError` | boolean | `true` | Include error details in test description |
| `skippedIssue` | boolean | `true` | Mark skipped tests as issues |
| `saveToFile` | boolean | `false` | Save cached commands to file for debugging |
| `launchId` | string | - | Existing launch ID to append results |
| `rerun` | boolean | `false` | Rerun mode |
| `rerunOf` | string | - | UUID of launch to rerun |

### Cache and File Save Mode

The reporter operates in always-cache mode, storing all commands in memory for reliable reporting. For debugging purposes, you can enable file persistence:

```javascript
{
  "reporters": [
    ["detox-rp-reporter", {
      "saveToFile": true,
      // ... other options
    }]
  ]
}
```

For more details about caching and offline capabilities, see [OFFLINE_MODE.md](./OFFLINE_MODE.md).

## Requirements

* Node.js 18.x or higher
* Yarn 4.x or higher
* Jest for test running
* Detox for mobile testing framework integration
* ReportPortal instance for test reporting

## Development

### Building the Project

```bash
# Install dependencies
yarn install

# Build the project
yarn build

# Run linting
yarn lint

# Format code
yarn format
```

### Project Structure

```text
src/
├── index.ts              # Main export
├── DetoxReporter.ts      # Core reporter implementation
├── AsyncQueue.ts         # Async operation queue
├── Storage.ts           # Internal storage utility
├── helper/
│   └── OfflineMod.ts    # Offline mode helper utilities
└── types/
    └── reportportal.d.ts # ReportPortal type definitions
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Issues

If you encounter any issues, please report them on [GitHub Issues](https://github.com/MadSandwich/detox-rp-reporter/issues).

## Support

For questions and support, please contact:

* **Author**: Artsem Burlai
* **Email**: <artemburlai@gmail.com>
* **Repository**: [detox-rp-reporter](https://github.com/MadSandwich/detox-rp-reporter)

## License

MIT - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

* [ReportPortal](https://reportportal.io/) for the excellent test reporting platform
* [Client Javascript](https://github.com/reportportal/client-javascript) for ReportPortal communication
* [Agent JS Jest](https://github.com/reportportal/agent-js-jest) for inspiration
* [Detox](https://github.com/wix/Detox) for the mobile testing framework
* [Jest](https://jestjs.io/) for the testing framework and reporter API
