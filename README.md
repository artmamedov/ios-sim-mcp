# ios-sim-mcp

A lightweight MCP (Model Context Protocol) server for iOS Simulator automation. Built for use with Claude Code and other MCP-compatible tools.

## Features

- **Screenshots** - Capture simulator screen as base64 PNG
- **Tap** - Tap at x,y coordinates
- **Swipe** - Swipe gestures
- **Type** - Type text into focused fields
- **App Management** - Launch, terminate, list apps
- **Device Control** - Boot/shutdown simulators, press buttons, open URLs

## Requirements

- macOS with Xcode installed
- Node.js 18+
- `cliclick` (for tap/swipe): `brew install cliclick`

## Installation

```bash
npm install -g ios-sim-mcp
```

Or clone and build:

```bash
git clone https://github.com/artmamedov/ios-sim-mcp.git
cd ios-sim-mcp
npm install
npm run build
```

## Usage with Claude Code

Add to your MCP configuration:

```bash
claude mcp add ios-sim -- npx ios-sim-mcp
```

Or manually add to your Claude config:

```json
{
  "mcpServers": {
    "ios-sim": {
      "command": "npx",
      "args": ["ios-sim-mcp"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_simulators` | List all available iOS simulators |
| `boot_simulator` | Boot a simulator by UDID |
| `shutdown_simulator` | Shutdown a simulator |
| `screenshot` | Take a screenshot (returns base64 PNG) |
| `launch_app` | Launch an app by bundle ID |
| `terminate_app` | Terminate an app |
| `tap` | Tap at x,y coordinates |
| `swipe` | Swipe from one point to another |
| `type_text` | Type text into focused field |
| `press_key` | Press keyboard key (enter, delete, etc.) |
| `press_button` | Press device button (home, volume, lock) |
| `open_url` | Open a URL in the simulator |
| `list_apps` | List installed apps |
| `get_screen_size` | Get screen dimensions |

## How It Works

- Uses `xcrun simctl` for simulator management, screenshots, and app control
- Uses `cliclick` for precise tap and swipe gestures
- Uses AppleScript to interact with the Simulator window
- Automatically finds the booted simulator if UDID not provided

## Examples

```
// List simulators
list_simulators()

// Take a screenshot
screenshot()

// Tap at coordinates
tap({ x: 200, y: 400 })

// Type into a field
type_text({ text: "hello@example.com" })
press_key({ key: "enter" })

// Swipe up
swipe({ startX: 200, startY: 600, endX: 200, endY: 200 })
```

## License

MIT
