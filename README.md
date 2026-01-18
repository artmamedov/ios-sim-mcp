# ios-sim-mcp

A Model Context Protocol (MCP) server for iOS Simulator automation. Enables AI assistants to visually interact with iOS apps running in the simulator.

## How It Works

This MCP server wraps [Facebook's idb (iOS Development Bridge)](https://github.com/facebook/idb) to provide isolated, headless control of iOS simulators. Unlike approaches that control your mouse/keyboard, idb injects touch events directly into the simulator:

- **Runs in the background** - doesn't take over your screen
- **Isolated** - you can use your computer while it runs
- **Reliable** - uses the same infrastructure Facebook uses for testing

## Requirements

- **macOS** (iOS Simulator only runs on Mac)
- **Xcode** with iOS Simulator installed
- **Node.js** 18+
- **idb** (install via steps below)

### Installing idb

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

## Coordinate System

**All coordinates are in POINTS, not pixels.**

- Points are device-independent units used by iOS
- Use `get_screen_size` to get both pixel and point dimensions
- Use `describe_screen` to get element coordinates in points
- Common sizes: iPhone 17 Pro is 393x852 points

## Common Workflows

### 1. Getting Started

```
list_simulators              → Find available simulators and their UDIDs
boot_simulator(udid)         → Boot the simulator you want
screenshot                   → Verify it's running, see the screen
```

### 2. Finding and Tapping UI Elements

```
# Option A: Search by label (recommended)
find_elements(label: "Sign In")  → Returns elements with matching labels
tap_element(label: "Sign In")    → Find and tap in one step

# Option B: Use coordinates from accessibility tree
describe_screen              → Get all elements with their frame coordinates
tap(x: 196, y: 425)          → Tap at the element's center
```

### 3. Filling Out Forms

```
tap_element(label: "Email")      → Focus the email field
type_text(text: "user@test.com") → Type the email
press_key(key: "tab")            → Move to next field
type_text(text: "password123")   → Type the password
tap_element(label: "Submit")     → Submit the form
```

### 4. Scrolling and Navigation

```
# Scroll down (swipe up)
swipe(startX: 200, startY: 600, endX: 200, endY: 200)

# Scroll up (swipe down)
swipe(startX: 200, startY: 200, endX: 200, endY: 600)

# Go back to home screen
press_button(button: "home")
```

### 5. Testing Deep Links

```
open_url(url: "myapp://profile/settings")  → Open custom URL scheme
screenshot                                  → Verify the right screen loaded
```

## Available Tools

### Simulator Management

| Tool | Description | Returns |
|------|-------------|---------|
| `list_simulators` | List all iOS simulators with state | Array: `[{name, udid, state, type, os_version}]` |
| `boot_simulator` | Boot simulator by UDID | Confirmation string |
| `shutdown_simulator` | Shutdown simulator | Confirmation string |

### Visual Feedback

| Tool | Description | Returns |
|------|-------------|---------|
| `screenshot` | Capture simulator screen | Base64 PNG image |
| `get_screen_size` | Get dimensions | `{pixels: {w,h}, points: {w,h}, scale}` |

### UI Discovery

| Tool | Description | Returns |
|------|-------------|---------|
| `describe_screen` | Get all UI elements | Array: `[{type, label, value, frame, enabled}]` |
| `describe_point` | Get element at coordinates | Element info string |
| `find_elements` | Search elements by label | Array of matching elements |

### Interactions

| Tool | Description | Returns |
|------|-------------|---------|
| `tap` | Tap at x,y coordinates (points) | Confirmation string |
| `tap_element` | Find element by label and tap it | Confirmation with coordinates |
| `swipe` | Swipe between two points | Confirmation string |
| `type_text` | Type into focused field | Confirmation string |
| `press_key` | Press keyboard key (enter, delete, tab, escape) | Confirmation string |
| `press_button` | Press device button (home, lock, siri, apple_pay) | Confirmation string |

### App Management

| Tool | Description | Returns |
|------|-------------|---------|
| `list_apps` | List installed apps | App list with bundle IDs |
| `launch_app` | Launch app by bundle ID | Confirmation string |
| `terminate_app` | Terminate running app | Confirmation string |
| `open_url` | Open URL (http or custom scheme) | Confirmation string |

## Element Discovery

The `describe_screen` tool returns UI elements in this format:

```json
[
  {
    "type": "Button",
    "label": "Sign In",
    "value": null,
    "frame": {"x": 147, "y": 400, "width": 100, "height": 50},
    "enabled": true
  },
  {
    "type": "TextField",
    "label": "Email",
    "value": "",
    "frame": {"x": 20, "y": 200, "width": 353, "height": 44},
    "enabled": true
  }
]
```

To tap an element, calculate its center:
- `centerX = frame.x + frame.width / 2`
- `centerY = frame.y + frame.height / 2`

Or use `tap_element` which does this automatically.

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

## Configuration

The server looks for `idb` in these locations:
1. `IDB_PATH` environment variable (if set)
2. `~/Library/Python/3.9/bin/idb`
3. `/opt/homebrew/bin/idb`
4. `/usr/local/bin/idb`
5. System PATH

## Troubleshooting

### "No booted simulator found"
Use `list_simulators` to find available simulators, then `boot_simulator` with the UDID.

### "idb not found"
Install idb: `pip3 install fb-idb`

### "No Companion Connected"
The idb companion usually starts automatically. If issues persist:
```bash
idb_companion --udid <simulator-udid>
```

### Tap not hitting the right element
1. Coordinates must be in **points**, not pixels
2. Use `describe_screen` to get exact element frames
3. Use `tap_element` with the element's label for more reliable tapping

### Element not found by label
1. Use `describe_screen` to see all available labels
2. Labels are case-insensitive partial matches
3. Some elements may not have accessibility labels set

## License

MIT

## Credits

- [Facebook idb](https://github.com/facebook/idb) - The underlying automation framework
- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol specification
