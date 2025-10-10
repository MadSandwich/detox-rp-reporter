# detox-rp-reporter

[![npm version](https://badge.fury.io/js/detox-rp-reporter.svg)](https://badge.fury.io/js/detox-rp-reporter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

A TypeScript-based Detox Reporter for ReportPortal test results uploader using Jest runner. This package provides seamless integration between Detox mobile testing framework and ReportPortal for comprehensive test reporting and analytics.

## Features

* **TypeScript Support**: Built with TypeScript for better type safety and developer experience
* **Detox Integration**: Specifically designed for Detox mobile testing framework  
* **Jest Reporter**: Works as a Jest custom reporter
* **ReportPortal Integration**: Uploads test results directly to ReportPortal
* **Always-Cache Mode**: All commands cached in memory for replay capability
* **Optional File Persistence**: Save cached commands to file when needed
* **Artifact Support**: Automatically attaches screenshots and videos from failed tests
* **Async Queue Processing**: Efficient handling of test result uploads
* **UUID-based Identifiers**: Reliable test item identification system
* **Error Handling**: Robust error handling and logging

## Installation

```bash
# Using yarn (recommended)
yarn add -D detox-rp-reporter

# Using npm
npm install --save-dev detox-rp-reporter
```

## Configuration

### Environment Variables

Configure ReportPortal connection using environment variables:

```bash
# ReportPortal Configuration
export RP_ENDPOINT=https://your-reportportal-instance.com
export RP_API_KEY=your-api-key
export RP_PROJECT_NAME=your-project-name
export RP_LAUNCH=your-launch-name
export RP_DESCRIPTION="Detox test execution"
export RP_MODE=DEFAULT

# Detox Artifacts Path
export DETOX_ARTIFACTS_PATH=.artifacts
```

### Jest Configuration

Add the reporter to your Jest configuration:

#### jest.config.js

```javascript
module.exports = {
  // ... other Jest configuration
  reporters: [
    'default',
    ['detox-rp-reporter', {
      endpoint: process.env.RP_ENDPOINT,
      apiKey: process.env.RP_API_KEY,
      project: process.env.RP_PROJECT_NAME,
      launch: process.env.RP_LAUNCH,
      description: process.env.RP_DESCRIPTION,
      mode: process.env.RP_MODE,
      artifactsPath: process.env.DETOX_ARTIFACTS_PATH,
      // Optional configuration
      extendTestDescriptionWithLastError: true,
      skippedIssue: false,
      attributes: [
        { key: 'framework', value: 'detox' },
        { key: 'platform', value: 'mobile' }
      ]
    }]
  ]
};
```

## Usage

### Basic Usage

Once configured, the reporter will automatically:

1. **Start Launch**: Create a new launch in ReportPortal when Jest starts
2. **Track Tests**: Monitor test execution and create test items in ReportPortal
3. **Handle Artifacts**: Attach screenshots and videos from failed tests
4. **Finish Launch**: Complete the launch when all tests finish

### Test Structure

The reporter works with standard Jest/Detox test structure:

```javascript
describe('Login Screen', () => {
  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should display login form', async () => {
    await expect(element(by.id('loginForm'))).toBeVisible();
  });

  it('should login with valid credentials', async () => {
    await element(by.id('usernameInput')).typeText('testuser');
    await element(by.id('passwordInput')).typeText('password');
    await element(by.id('loginButton')).tap();
    
    await expect(element(by.id('homeScreen'))).toBeVisible();
  });
});
```

### Artifact Handling

The reporter automatically searches for and attaches:

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
| `extendTestDescriptionWithLastError` | boolean | `true` | Include error details in test description |
| `skippedIssue` | boolean | `true` | Mark skipped tests as issues |
| `attributes` | array | `[]` | Launch attributes |
| `launchId` | string | - | Existing launch ID to append results |
| `rerun` | boolean | `false` | Rerun mode |
| `rerunOf` | string | - | UUID of launch to rerun |

## Advanced Usage

### Launch Management

#### Append to Existing Launch

```javascript
{
  "reporters": [
    ["detox-rp-reporter", {
      "launchId": "existing-launch-uuid"
      // ... other options
    }]
  ]
}
```

#### Rerun Failed Tests

```javascript
{
  "reporters": [
    ["detox-rp-reporter", {
      "rerun": true,
      "rerunOf": "failed-launch-uuid"
      // ... other options
    }]
  ]
}
```

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
└── types/
    └── reportportal.d.ts # ReportPortal type definitions (Will be removed once TS integration PR will be merged)
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Requirements

* **Node.js**: 18.x or higher
* **Yarn**: 4.x or higher
* **Jest**: Compatible with Jest reporters API
* **Detox**: For mobile testing framework integration
* **ReportPortal**: Instance for test reporting

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Issues

If you encounter any issues, please report them on [GitHub Issues](https://github.com/MadSandwich/detox-rp-reporter/issues).

## Support

For questions and support, please contact:

* **Author**: Artsem Burlai
* **Email**: <artemburlai@gmail.com>
* **Repository**: [detox-rp-reporter](https://github.com/MadSandwich/detox-rp-reporter)

## Acknowledgments

* [ReportPortal](https://reportportal.io/) for the excellent test reporting platform
* [Client Javascript](https://github.com/reportportal/client-javascript) for make it possible to easy communicate
* [Agent JS Jest](https://github.com/reportportal/agent-js-jest) for inspiration
* [Detox](https://github.com/wix/Detox) for the mobile testing framework
* [Jest](https://jestjs.io/) for the testing framework and reporter API
