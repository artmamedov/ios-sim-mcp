#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

// Find idb executable
function findIdb(): string {
  // Check environment variable first
  if (process.env.IDB_PATH) {
    return process.env.IDB_PATH;
  }

  // Common locations
  const locations = [
    path.join(os.homedir(), "Library/Python/3.9/bin/idb"),
    "/opt/homebrew/bin/idb",
    "/usr/local/bin/idb",
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  // Fall back to PATH
  return "idb";
}

const IDB = findIdb();

// Execute idb command
async function idb(args: string): Promise<string> {
  const { stdout, stderr } = await execAsync(`${IDB} ${args}`);
  if (stderr && !stdout) {
    throw new Error(stderr);
  }
  return stdout.trim();
}

interface Simulator {
  udid: string;
  name: string;
  state: string;
  type: string;
  os_version: string;
}

// Parse idb list-targets output
function parseListTargets(output: string): Simulator[] {
  const lines = output.split("\n").filter((l) => l.trim());
  return lines.map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    return {
      name: parts[0] || "",
      udid: parts[1] || "",
      state: parts[2] || "",
      type: parts[3] || "",
      os_version: parts[4] || "",
    };
  });
}

// List available simulators
async function listSimulators(): Promise<Simulator[]> {
  const output = await idb("list-targets");
  return parseListTargets(output);
}

// Get booted simulator
async function getBootedSimulator(): Promise<Simulator | null> {
  const simulators = await listSimulators();
  return simulators.find((s) => s.state === "Booted") || null;
}

// Boot a simulator
async function bootSimulator(udid: string): Promise<string> {
  await idb(`boot --udid ${udid}`);
  return `Booted simulator ${udid}`;
}

// Shutdown a simulator
async function shutdownSimulator(udid: string): Promise<string> {
  await idb(`shutdown --udid ${udid}`);
  return `Shut down simulator ${udid}`;
}

// Take a screenshot
async function takeScreenshot(udid: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `sim-screenshot-${Date.now()}.png`);
  await idb(`screenshot ${tmpFile} --udid ${udid}`);
  const imageData = fs.readFileSync(tmpFile);
  const base64 = imageData.toString("base64");
  fs.unlinkSync(tmpFile);
  return base64;
}

// Launch an app
async function launchApp(udid: string, bundleId: string): Promise<string> {
  await idb(`launch ${bundleId} --udid ${udid}`);
  return `Launched ${bundleId}`;
}

// Terminate an app
async function terminateApp(udid: string, bundleId: string): Promise<string> {
  await idb(`terminate ${bundleId} --udid ${udid}`);
  return `Terminated ${bundleId}`;
}

// Tap at coordinates
async function tap(udid: string, x: number, y: number): Promise<string> {
  await idb(`ui tap ${x} ${y} --udid ${udid}`);
  return `Tapped at (${x}, ${y})`;
}

// Swipe
async function swipe(
  udid: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  duration?: number
): Promise<string> {
  const durationArg = duration ? `--duration ${duration / 1000}` : "";
  await idb(`ui swipe ${startX} ${startY} ${endX} ${endY} ${durationArg} --udid ${udid}`);
  return `Swiped from (${startX}, ${startY}) to (${endX}, ${endY})`;
}

// Type text
async function typeText(udid: string, text: string): Promise<string> {
  // Escape quotes for shell
  const escaped = text.replace(/'/g, "'\\''");
  await idb(`ui text '${escaped}' --udid ${udid}`);
  return `Typed: ${text}`;
}

// Press a key
async function pressKey(udid: string, keycode: number): Promise<string> {
  await idb(`ui key ${keycode} --udid ${udid}`);
  return `Pressed key: ${keycode}`;
}

// Press device button
async function pressButton(udid: string, button: string): Promise<string> {
  const validButtons = ["apple_pay", "home", "lock", "side_button", "siri"];
  if (!validButtons.includes(button.toLowerCase())) {
    throw new Error(`Invalid button: ${button}. Valid buttons: ${validButtons.join(", ")}`);
  }
  await idb(`ui button ${button.toUpperCase()} --udid ${udid}`);
  return `Pressed button: ${button}`;
}

// Open URL
async function openUrl(udid: string, url: string): Promise<string> {
  await idb(`open ${url} --udid ${udid}`);
  return `Opened URL: ${url}`;
}

// List installed apps
async function listApps(udid: string): Promise<string> {
  const output = await idb(`list-apps --udid ${udid}`);
  return output;
}

// Get screen info via describe
async function describeScreen(udid: string): Promise<string> {
  const output = await idb(`ui describe-all --udid ${udid}`);
  return output;
}

// Describe point
async function describePoint(udid: string, x: number, y: number): Promise<string> {
  const output = await idb(`ui describe-point ${x} ${y} --udid ${udid}`);
  return output;
}

// Get screen size by taking a screenshot and checking dimensions
async function getScreenSize(udid: string): Promise<{ width: number; height: number }> {
  const tmpFile = path.join(os.tmpdir(), `sim-size-${Date.now()}.png`);
  await idb(`screenshot ${tmpFile} --udid ${udid}`);
  const { stdout } = await execAsync(`sips -g pixelWidth -g pixelHeight "${tmpFile}"`);
  fs.unlinkSync(tmpFile);

  const widthMatch = stdout.match(/pixelWidth: (\d+)/);
  const heightMatch = stdout.match(/pixelHeight: (\d+)/);

  return {
    width: widthMatch ? parseInt(widthMatch[1]) : 0,
    height: heightMatch ? parseInt(heightMatch[1]) : 0,
  };
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
            udid: {
              type: "string",
              description: "Simulator UDID (optional, uses booted simulator if not provided)",
            },
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
            button: {
              type: "string",
              description: "Button name: home, lock, volume-up, volume-down",
            },
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
      {
        name: "describe_screen",
        description: "Get accessibility tree of the current screen (useful for finding tap targets)",
        inputSchema: {
          type: "object",
          properties: {
            udid: { type: "string", description: "Simulator UDID (optional)" },
          },
        },
      },
      {
        name: "describe_point",
        description: "Get accessibility info at specific coordinates",
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
        const udid = await getUdid(args?.udid as string);
        const result = await typeText(udid, args?.text as string);
        return { content: [{ type: "text", text: result }] };
      }

      case "press_key": {
        const udid = await getUdid(args?.udid as string);
        // Map common key names to keycodes
        const keyMap: Record<string, number> = {
          enter: 40,
          return: 40,
          tab: 43,
          delete: 42,
          backspace: 42,
          escape: 41,
          space: 44,
        };
        const key = (args?.key as string).toLowerCase();
        const keycode = keyMap[key] || key.charCodeAt(0);
        const result = await pressKey(udid, keycode);
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
        return { content: [{ type: "text", text: apps }] };
      }

      case "get_screen_size": {
        const udid = await getUdid(args?.udid as string);
        const size = await getScreenSize(udid);
        return { content: [{ type: "text", text: JSON.stringify(size) }] };
      }

      case "describe_screen": {
        const udid = await getUdid(args?.udid as string);
        const description = await describeScreen(udid);
        return { content: [{ type: "text", text: description }] };
      }

      case "describe_point": {
        const udid = await getUdid(args?.udid as string);
        const description = await describePoint(udid, args?.x as number, args?.y as number);
        return { content: [{ type: "text", text: description }] };
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
  console.error("iOS Simulator MCP server running on stdio (using idb)");
}

main().catch(console.error);
