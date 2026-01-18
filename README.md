# ios-sim-mcp

A Model Context Protocol (MCP) server for iOS Simulator automation. Enables AI assistants like Claude to visually interact with iOS apps running in the simulator.

## How It Works

This MCP server wraps [Facebook's idb (iOS Development Bridge)](https://github.com/facebook/idb) to provide isolated, headless control of iOS simulators. Unlike approaches that control your mouse/keyboard, idb injects touch events directly into the simulator - meaning:

- **Runs in the background** - doesn't take over your screen
- **Isolated** - you can use your computer while it runs
- **Reliable** - uses the same infrastructure Facebook uses for testing

## Requirements

- **macOS** (iOS Simulator only runs on Mac)
- **Xcode** with iOS Simulator installed
- **Node.js** 18+
- **idb** (installed automatically, or manually via steps below)

### Installing idb manually

```bash
# Install idb-companion (the daemon)
brew tap facebook/fb
brew install idb-companion

# Install idb (the Python CLI client)
pip3 install fb-idb
```

## Installation

### Option 1: Install from npm (recommended)

```bash
npm install -g ios-sim-mcp
```

### Option 2: Clone and build

```bash
git clone https://github.com/artmamedov/ios-sim-mcp.git
cd ios-sim-mcp
npm install
npm run build
```

## Usage with Claude Code

```bash
claude mcp add ios-sim -s user -- npx ios-sim-mcp
```

Or if installed from source:

```bash
claude mcp add ios-sim -s user -- node /path/to/ios-sim-mcp/dist/index.js
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_simulators` | List all available iOS simulators with state |
| `boot_simulator` | Boot a simulator by UDID |
| `shutdown_simulator` | Shutdown a simulator |
| `screenshot` | Take a screenshot (returns base64 PNG) |
| `launch_app` | Launch an app by bundle ID |
| `terminate_app` | Terminate a running app |
| `list_apps` | List installed apps on simulator |
| `tap` | Tap at x,y coordinates |
| `swipe` | Swipe from one point to another |
| `type_text` | Type text into focused field |
| `press_key` | Press a keyboard key |
| `press_button` | Press device button (home, lock, siri, apple_pay) |
| `open_url` | Open a URL in the simulator |
| `get_screen_size` | Get simulator screen dimensions |
| `describe_screen` | Get accessibility tree of current screen |
| `describe_point` | Get accessibility info at specific coordinates |
| `find_elements` | Find UI elements by label (case-insensitive partial match) |
| `tap_element` | Find an element by label and tap it |

## Example Usage

Once connected, Claude can:

```
// List available simulators
list_simulators()

// Boot iPhone 17 Pro
boot_simulator({ udid: "FFD39627-..." })

// Take a screenshot to see what's on screen
screenshot()

// Tap on a button at coordinates
tap({ x: 200, y: 400 })

// Type into a text field
type_text({ text: "hello@example.com" })

// Swipe up to scroll
swipe({ startX: 200, startY: 600, endX: 200, endY: 200 })

// Get accessibility info for the screen
describe_screen()
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Claude/LLM    │────▶│  ios-sim-mcp    │────▶│  idb companion  │
│                 │ MCP │  (this server)  │ CLI │  (Facebook's)   │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │  iOS Simulator  │
                                                │  (Xcode)        │
                                                └─────────────────┘
```

- **MCP Protocol**: Communication between Claude and this server
- **idb CLI**: This server executes idb commands to control the simulator
- **idb companion**: A daemon that interfaces with the simulator at a low level

## Configuration

The server looks for `idb` in these locations:
1. System PATH
2. `/Users/{user}/Library/Python/3.9/bin/idb`
3. `/opt/homebrew/bin/idb`

You can also set the `IDB_PATH` environment variable to specify a custom location.

## Troubleshooting

### "idb not found"
Make sure idb is installed: `pip3 install fb-idb`

### "No Companion Connected"
The idb companion starts automatically when needed. If issues persist:
```bash
idb_companion --udid <simulator-udid>
```

### Tap coordinates are wrong
Coordinates are in screen points (not pixels). Use `get_screen_size()` to see dimensions, or `describe_screen()` to get element positions.

## License

MIT

## Credits

- [Facebook idb](https://github.com/facebook/idb) - The underlying automation framework
- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol specification
