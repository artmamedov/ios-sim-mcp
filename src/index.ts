#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

interface Simulator {
  udid: string;
  name: string;
  state: string;
  runtime: string;
}

// Get list of available simulators
async function listSimulators(): Promise<Simulator[]> {
  const { stdout } = await execAsync("xcrun simctl list devices -j");
  const data = JSON.parse(stdout);
  const simulators: Simulator[] = [];

  for (const [runtime, devices] of Object.entries(data.devices) as [string, any[]][]) {
    for (const device of devices) {
      if (device.isAvailable) {
        simulators.push({
          udid: device.udid,
          name: device.name,
          state: device.state,
          runtime: runtime.replace("com.apple.CoreSimulator.SimRuntime.", ""),
        });
      }
    }
  }

  return simulators;
}

// Get booted simulator
async function getBootedSimulator(): Promise<Simulator | null> {
  const simulators = await listSimulators();
  return simulators.find((s) => s.state === "Booted") || null;
}

// Boot a simulator
async function bootSimulator(udid: string): Promise<string> {
  try {
    await execAsync(`xcrun simctl boot ${udid}`);
    await execAsync("open -a Simulator");
    return `Booted simulator ${udid}`;
  } catch (error: any) {
    if (error.message.includes("current state: Booted")) {
      return "Simulator already booted";
    }
    throw error;
  }
}

// Shutdown a simulator
async function shutdownSimulator(udid: string): Promise<string> {
  await execAsync(`xcrun simctl shutdown ${udid}`);
  return `Shut down simulator ${udid}`;
}

// Take a screenshot
async function takeScreenshot(udid: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `sim-screenshot-${Date.now()}.png`);
  await execAsync(`xcrun simctl io ${udid} screenshot "${tmpFile}"`);
  const imageData = fs.readFileSync(tmpFile);
  const base64 = imageData.toString("base64");
  fs.unlinkSync(tmpFile);
  return base64;
}

// Launch an app
async function launchApp(udid: string, bundleId: string): Promise<string> {
  const { stdout } = await execAsync(`xcrun simctl launch ${udid} ${bundleId}`);
  return stdout.trim() || `Launched ${bundleId}`;
}

// Terminate an app
async function terminateApp(udid: string, bundleId: string): Promise<string> {
  await execAsync(`xcrun simctl terminate ${udid} ${bundleId}`);
  return `Terminated ${bundleId}`;
}

// Get Simulator window bounds using AppleScript
async function getSimulatorWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const script = `
    tell application "System Events"
      tell process "Simulator"
        set frontWindow to front window
        set {x, y} to position of frontWindow
        set {w, h} to size of frontWindow
        return {x, y, w, h}
      end tell
    end tell
  `;
  try {
    const { stdout } = await execAsync(`osascript -e '${script}'`);
    const [x, y, w, h] = stdout.trim().split(", ").map(Number);
    return { x, y, width: w, height: h };
  } catch {
    return null;
  }
}

// Get simulator screen size
async function getSimulatorScreenSize(udid: string): Promise<{ width: number; height: number }> {
  // Take a screenshot and get dimensions
  const tmpFile = path.join(os.tmpdir(), `sim-size-${Date.now()}.png`);
  await execAsync(`xcrun simctl io ${udid} screenshot "${tmpFile}"`);
  const { stdout } = await execAsync(`sips -g pixelWidth -g pixelHeight "${tmpFile}"`);
  fs.unlinkSync(tmpFile);

  const widthMatch = stdout.match(/pixelWidth: (\d+)/);
  const heightMatch = stdout.match(/pixelHeight: (\d+)/);

  return {
    width: widthMatch ? parseInt(widthMatch[1]) : 390,
    height: heightMatch ? parseInt(heightMatch[1]) : 844,
  };
}

// Tap at coordinates using cliclick
async function tap(udid: string, x: number, y: number): Promise<string> {
  const bounds = await getSimulatorWindowBounds();
  if (!bounds) {
    throw new Error("Could not get Simulator window bounds. Is Simulator running?");
  }

  const screenSize = await getSimulatorScreenSize(udid);

  // Account for window chrome (title bar ~28px, and device bezel in simulator)
  const titleBarHeight = 28;
  const contentHeight = bounds.height - titleBarHeight;

  // Scale coordinates from simulator screen to window
  const scaleX = bounds.width / screenSize.width;
  const scaleY = contentHeight / screenSize.height;

  const screenX = Math.round(bounds.x + x * scaleX);
  const screenY = Math.round(bounds.y + titleBarHeight + y * scaleY);

  await execAsync(`cliclick c:${screenX},${screenY}`);
  return `Tapped at (${x}, ${y}) -> screen (${screenX}, ${screenY})`;
}

// Swipe using cliclick drag
async function swipe(
  udid: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs: number = 300
): Promise<string> {
  const bounds = await getSimulatorWindowBounds();
  if (!bounds) {
    throw new Error("Could not get Simulator window bounds. Is Simulator running?");
  }

  const screenSize = await getSimulatorScreenSize(udid);
  const titleBarHeight = 28;
  const contentHeight = bounds.height - titleBarHeight;

  const scaleX = bounds.width / screenSize.width;
  const scaleY = contentHeight / screenSize.height;

  const screenStartX = Math.round(bounds.x + startX * scaleX);
  const screenStartY = Math.round(bounds.y + titleBarHeight + startY * scaleY);
  const screenEndX = Math.round(bounds.x + endX * scaleX);
  const screenEndY = Math.round(bounds.y + titleBarHeight + endY * scaleY);

  // cliclick drag command: dd (drag down) from start to end
  await execAsync(`cliclick dd:${screenStartX},${screenStartY} du:${screenEndX},${screenEndY}`);
  return `Swiped from (${startX}, ${startY}) to (${endX}, ${endY})`;
}

// Type text using clipboard and paste
async function typeText(text: string): Promise<string> {
  // Copy text to clipboard
  await execAsync(`echo -n "${text.replace(/"/g, '\\"')}" | pbcopy`);
  // Paste using Command+V via AppleScript
  const script = `
    tell application "System Events"
      tell process "Simulator"
        set frontmost to true
        keystroke "v" using command down
      end tell
    end tell
  `;
  await execAsync(`osascript -e '${script}'`);
  return `Typed: ${text}`;
}

// Press a key using AppleScript
async function pressKey(key: string): Promise<string> {
  let keystroke: string;

  switch (key.toLowerCase()) {
    case "enter":
    case "return":
      keystroke = 'key code 36'; // Return key
      break;
    case "delete":
    case "backspace":
      keystroke = 'key code 51'; // Delete key
      break;
    case "escape":
      keystroke = 'key code 53';
      break;
    case "tab":
      keystroke = 'key code 48';
      break;
    default:
      keystroke = `keystroke "${key}"`;
  }

  const script = `
    tell application "System Events"
      tell process "Simulator"
        set frontmost to true
        ${keystroke}
      end tell
    end tell
  `;
  await execAsync(`osascript -e '${script}'`);
  return `Pressed key: ${key}`;
}

// Press device button (home, etc.)
async function pressButton(udid: string, button: string): Promise<string> {
  const buttonMap: Record<string, string> = {
    home: "home",
    lock: "lock",
    "volume-up": "volume up",
    "volume-down": "volume down",
  };

  const simButton = buttonMap[button.toLowerCase()];
  if (!simButton) {
    throw new Error(`Unknown button: ${button}. Supported: home, lock, volume-up, volume-down`);
  }

  // Use AppleScript to trigger menu items
  if (button.toLowerCase() === "home") {
    const script = `
      tell application "System Events"
        tell process "Simulator"
          click menu item "Home" of menu "Device" of menu bar 1
        end tell
      end tell
    `;
    await execAsync(`osascript -e '${script}'`);
  } else {
    // For other buttons, try simctl
    await execAsync(`xcrun simctl ui ${udid} button ${simButton}`).catch(() => {
      // Fallback - some buttons may not be available
    });
  }

  return `Pressed button: ${button}`;
}

// Open URL in simulator
async function openUrl(udid: string, url: string): Promise<string> {
  await execAsync(`xcrun simctl openurl ${udid} "${url}"`);
  return `Opened URL: ${url}`;
}

// List installed apps
async function listApps(udid: string): Promise<string[]> {
  const { stdout } = await execAsync(`xcrun simctl listapps ${udid}`);
  const apps: string[] = [];
  const bundleIdRegex = /CFBundleIdentifier = "([^"]+)"/g;
  let match;
  while ((match = bundleIdRegex.exec(stdout)) !== null) {
    apps.push(match[1]);
  }
  return apps;
}

// Create the MCP server
const server = new Server(
  {
    name: "ios-sim-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_simulators",
        description: "List all available iOS simulators",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "boot_simulator",
        description: "Boot an iOS simulator by UDID",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID" },
          },
          required: ["udid"],
        },
      },
      {
        name: "shutdown_simulator",
        description: "Shutdown an iOS simulator by UDID",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID" },
          },
          required: ["udid"],
        },
      },
      {
        name: "screenshot",
        description: "Take a screenshot of the simulator. Returns base64 PNG image.",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional, uses booted simulator if not provided)" },
          },
        },
      },
      {
        name: "launch_app",
        description: "Launch an app on the simulator",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional)" },
            bundleId: { type: "string", description: "App bundle identifier" },
          },
          required: ["bundleId"],
        },
      },
      {
        name: "terminate_app",
        description: "Terminate an app on the simulator",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional)" },
            bundleId: { type: "string", description: "App bundle identifier" },
          },
          required: ["bundleId"],
        },
      },
      {
        name: "tap",
        description: "Tap at x,y coordinates on the simulator screen",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional)" },
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" },
          },
          required: ["x", "y"],
        },
      },
      {
        name: "swipe",
        description: "Swipe from one point to another on the simulator",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional)" },
            startX: { type: "number", description: "Start X coordinate" },
            startY: { type: "number", description: "Start Y coordinate" },
            endX: { type: "number", description: "End X coordinate" },
            endY: { type: "number", description: "End Y coordinate" },
            duration: { type: "number", description: "Duration in milliseconds (default 300)" },
          },
          required: ["startX", "startY", "endX", "endY"],
        },
      },
      {
        name: "type_text",
        description: "Type text into the focused field",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to type" },
          },
          required: ["text"],
        },
      },
      {
        name: "press_key",
        description: "Press a keyboard key (enter, delete, escape, tab, or any character)",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", description: "Key to press" },
          },
          required: ["key"],
        },
      },
      {
        name: "press_button",
        description: "Press a device button (home, lock, volume-up, volume-down)",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional)" },
            button: { type: "string", description: "Button name: home, lock, volume-up, volume-down" },
          },
          required: ["button"],
        },
      },
      {
        name: "open_url",
        description: "Open a URL in the simulator",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional)" },
            url: { type: "string", description: "URL to open" },
          },
          required: ["url"],
        },
      },
      {
        name: "list_apps",
        description: "List installed apps on the simulator",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional)" },
          },
        },
      },
      {
        name: "get_screen_size",
        description: "Get the simulator screen dimensions",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional)" },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Helper to get UDID (use provided or find booted)
  async function getUdid(providedUdid?: string): Promise<string> {
    if (providedUdid) return providedUdid;
    const booted = await getBootedSimulator();
    if (!booted) throw new Error("No booted simulator found. Please provide a UDID or boot a simulator.");
    return booted.udid;
  }

  try {
    switch (name) {
      case "list_simulators": {
        const simulators = await listSimulators();
        return {
          content: [{ type: "text", text: JSON.stringify(simulators, null, 2) }],
        };
      }

      case "boot_simulator": {
        const result = await bootSimulator(args?.udid as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "shutdown_simulator": {
        const result = await shutdownSimulator(args?.udid as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "screenshot": {
        const udid = await getUdid(args?.udid as string);
        const base64 = await takeScreenshot(udid);
        return {
          content: [{ type: "image", data: base64, mimeType: "image/png" }],
        };
      }

      case "launch_app": {
        const udid = await getUdid(args?.udid as string);
        const result = await launchApp(udid, args?.bundleId as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "terminate_app": {
        const udid = await getUdid(args?.udid as string);
        const result = await terminateApp(udid, args?.bundleId as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "tap": {
        const udid = await getUdid(args?.udid as string);
        const result = await tap(udid, args?.x as number, args?.y as number);
        return { content: [{ type: "text", text: result }] };
      }

      case "swipe": {
        const udid = await getUdid(args?.udid as string);
        const result = await swipe(
          udid,
          args?.startX as number,
          args?.startY as number,
          args?.endX as number,
          args?.endY as number,
          args?.duration as number
        );
        return { content: [{ type: "text", text: result }] };
      }

      case "type_text": {
        const result = await typeText(args?.text as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "press_key": {
        const result = await pressKey(args?.key as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "press_button": {
        const udid = await getUdid(args?.udid as string);
        const result = await pressButton(udid, args?.button as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "open_url": {
        const udid = await getUdid(args?.udid as string);
        const result = await openUrl(udid, args?.url as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "list_apps": {
        const udid = await getUdid(args?.udid as string);
        const apps = await listApps(udid);
        return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
      }

      case "get_screen_size": {
        const udid = await getUdid(args?.udid as string);
        const size = await getSimulatorScreenSize(udid);
        return { content: [{ type: "text", text: JSON.stringify(size) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("iOS Simulator MCP server running on stdio");
}

main().catch(console.error);
