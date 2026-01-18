#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as idb from "./idb.js";

const server = new Server(
  { name: "ios-sim-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Tool definitions with AI-agent-friendly descriptions
const tools = [
  {
    name: "list_simulators",
    description: "List all available iOS simulators with their current state. Returns array of simulators with name, udid, state (Booted/Shutdown), type, and os_version. Use this first to find simulator UDIDs for other commands.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "boot_simulator",
    description: "Boot an iOS simulator by UDID. Simulator must be booted before you can interact with it. Use list_simulators first to find available UDIDs. Returns confirmation message on success.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID from list_simulators (e.g., 'FFD39627-3B87-4E21-B773-3AD45DA1B7A5')",
        },
      },
      required: ["udid"],
    },
  },
  {
    name: "shutdown_simulator",
    description: "Shutdown a running iOS simulator by UDID. Use when done testing to free system resources.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID to shutdown",
        },
      },
      required: ["udid"],
    },
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the simulator screen. Returns base64-encoded PNG image. Use this to see the current UI state before interacting. If no udid provided, uses the currently booted simulator.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
      },
    },
  },
  {
    name: "launch_app",
    description: "Launch an app on the simulator by bundle ID. App must be installed on the simulator. Use list_apps to find installed bundle IDs. Returns confirmation on success.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
        bundleId: {
          type: "string",
          description: "App bundle identifier (e.g., 'com.apple.mobilesafari', 'com.example.myapp')",
        },
      },
      required: ["bundleId"],
    },
  },
  {
    name: "terminate_app",
    description: "Terminate a running app on the simulator. Use to close an app without shutting down the simulator.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
        bundleId: {
          type: "string",
          description: "Bundle ID of app to terminate (e.g., 'com.apple.mobilesafari')",
        },
      },
      required: ["bundleId"],
    },
  },
  {
    name: "tap",
    description: "Tap at x,y coordinates on the simulator screen. Coordinates are in POINTS (not pixels). Use describe_screen or find_elements to get element coordinates, or get_screen_size to understand the coordinate system.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
        x: {
          type: "number",
          description: "X coordinate in points (0 = left edge)",
        },
        y: {
          type: "number",
          description: "Y coordinate in points (0 = top edge)",
        },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "swipe",
    description: "Swipe from one point to another on the simulator. Use for scrolling (swipe up to scroll down), dismissing, or navigating. Coordinates are in POINTS.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
        startX: {
          type: "number",
          description: "Starting X coordinate in points",
        },
        startY: {
          type: "number",
          description: "Starting Y coordinate in points",
        },
        endX: {
          type: "number",
          description: "Ending X coordinate in points",
        },
        endY: {
          type: "number",
          description: "Ending Y coordinate in points",
        },
        duration: {
          type: "number",
          description: "Swipe duration in milliseconds (default: 300, range: 100-5000). Slower swipes for precise control.",
        },
      },
      required: ["startX", "startY", "endX", "endY"],
    },
  },
  {
    name: "type_text",
    description: "Type text into the currently focused text field. A text field must be focused first (tap on it). For special keys like Enter, use press_key instead.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to type (supports unicode, emojis)",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "press_key",
    description: "Press a keyboard key. Use for special keys like enter/return to submit forms, delete/backspace to erase, escape to cancel, tab to move focus, or any single character.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key name: 'enter', 'return', 'delete', 'backspace', 'escape', 'tab', 'space', or any single character",
          enum: ["enter", "return", "delete", "backspace", "escape", "tab", "space"],
        },
      },
      required: ["key"],
    },
  },
  {
    name: "press_button",
    description: "Press a physical device button. Home button goes to home screen, lock toggles screen lock, siri activates Siri, apple_pay triggers Apple Pay.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
        button: {
          type: "string",
          description: "Button to press",
          enum: ["home", "lock", "siri", "apple_pay"],
        },
      },
      required: ["button"],
    },
  },
  {
    name: "open_url",
    description: "Open a URL in the simulator. Opens in the default handler - http/https URLs open in Safari, custom URL schemes open their registered apps (e.g., 'myapp://path').",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
        url: {
          type: "string",
          description: "URL to open (e.g., 'https://example.com' or 'myapp://deeplink')",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "list_apps",
    description: "List all installed apps on the simulator. Returns bundle IDs and app info. Use this to find bundle IDs for launch_app and terminate_app.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
      },
    },
  },
  {
    name: "get_screen_size",
    description: "Get simulator screen dimensions in both pixels and points, plus scale factor. Coordinates for tap/swipe use POINTS. Returns: { pixels: {width, height}, points: {width, height}, scale }",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
      },
    },
  },
  {
    name: "describe_screen",
    description: "Get all interactive UI elements on the current screen with their accessibility labels, types, and frame coordinates. Returns array of elements with: type, label, value, frame {x, y, width, height}, enabled. Use this to find elements before tapping. Coordinates are in POINTS.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
      },
    },
  },
  {
    name: "describe_point",
    description: "Get accessibility info for the UI element at specific coordinates. Use to identify what element is at a particular location. Coordinates are in POINTS.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
        x: {
          type: "number",
          description: "X coordinate in points",
        },
        y: {
          type: "number",
          description: "Y coordinate in points",
        },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "find_elements",
    description: "Search for UI elements by accessibility label. Case-insensitive partial match. Returns array of matching elements with type, label, value, and frame coordinates. Use this to find elements by text content, then tap_element or tap using the frame coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
        label: {
          type: "string",
          description: "Text to search for in element labels (case-insensitive, partial match)",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "tap_element",
    description: "Find an element by its accessibility label and tap its center. Easier than find_elements + tap when you know the element's label. Throws error if no matching element found - use find_elements first to verify the label exists.",
    inputSchema: {
      type: "object",
      properties: {
        udid: {
          type: "string",
          description: "Simulator UDID (optional - uses booted simulator if not provided)",
        },
        label: {
          type: "string",
          description: "Accessibility label to search for and tap (case-insensitive, partial match)",
        },
      },
      required: ["label"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

// Helper to get UDID with actionable error
async function getUdid(providedUdid?: string): Promise<string> {
  if (providedUdid) return providedUdid;
  const booted = await idb.getBootedSimulator();
  if (!booted) throw idb.noBootedSimulatorError();
  return booted.udid;
}

// Key name to keycode mapping
const keyMap: Record<string, number> = {
  enter: 40, return: 40, tab: 43, delete: 42, backspace: 42, escape: 41, space: 44,
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_simulators":
        return { content: [{ type: "text", text: JSON.stringify(await idb.listSimulators(), null, 2) }] };

      case "boot_simulator":
        return { content: [{ type: "text", text: await idb.bootSimulator(args?.udid as string) }] };

      case "shutdown_simulator":
        return { content: [{ type: "text", text: await idb.shutdownSimulator(args?.udid as string) }] };

      case "screenshot": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "image", data: await idb.takeScreenshot(udid), mimeType: "image/png" }] };
      }

      case "launch_app": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: await idb.launchApp(udid, args?.bundleId as string) }] };
      }

      case "terminate_app": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: await idb.terminateApp(udid, args?.bundleId as string) }] };
      }

      case "tap": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: await idb.tap(udid, args?.x as number, args?.y as number) }] };
      }

      case "swipe": {
        const udid = await getUdid(args?.udid as string);
        return {
          content: [{
            type: "text",
            text: await idb.swipe(udid, args?.startX as number, args?.startY as number, args?.endX as number, args?.endY as number, args?.duration as number),
          }],
        };
      }

      case "type_text": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: await idb.typeText(udid, args?.text as string) }] };
      }

      case "press_key": {
        const udid = await getUdid(args?.udid as string);
        const key = (args?.key as string).toLowerCase();
        const keycode = keyMap[key] || key.charCodeAt(0);
        return { content: [{ type: "text", text: await idb.pressKey(udid, keycode) }] };
      }

      case "press_button": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: await idb.pressButton(udid, args?.button as string) }] };
      }

      case "open_url": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: await idb.openUrl(udid, args?.url as string) }] };
      }

      case "list_apps": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: await idb.listApps(udid) }] };
      }

      case "get_screen_size": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: JSON.stringify(await idb.getScreenSize(udid)) }] };
      }

      case "describe_screen": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: JSON.stringify(await idb.describeScreen(udid), null, 2) }] };
      }

      case "describe_point": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: await idb.describePoint(udid, args?.x as number, args?.y as number) }] };
      }

      case "find_elements": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: JSON.stringify(await idb.findElements(udid, args?.label as string), null, 2) }] };
      }

      case "tap_element": {
        const udid = await getUdid(args?.udid as string);
        return { content: [{ type: "text", text: await idb.tapElement(udid, args?.label as string) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("iOS Simulator MCP server running on stdio (using idb)");
}

main().catch(console.error);
