#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as idb from "./idb.js";

const server = new Server(
  { name: "ios-sim-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Tool definitions
const tools = [
  {
    name: "list_simulators",
    description: "List all available iOS simulators",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "boot_simulator",
    description: "Boot an iOS simulator by UDID",
    inputSchema: {
      type: "object",
      properties: { udid: { type: "string", description: "Simulator UDID" } },
      required: ["udid"],
    },
  },
  {
    name: "shutdown_simulator",
    description: "Shutdown an iOS simulator by UDID",
    inputSchema: {
      type: "object",
      properties: { udid: { type: "string", description: "Simulator UDID" } },
      required: ["udid"],
    },
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the simulator. Returns base64 PNG image.",
    inputSchema: {
      type: "object",
      properties: { udid: { type: "string", description: "Simulator UDID (optional)" } },
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
        duration: { type: "number", description: "Duration in milliseconds" },
      },
      required: ["startX", "startY", "endX", "endY"],
    },
  },
  {
    name: "type_text",
    description: "Type text into the focused field",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to type" } },
      required: ["text"],
    },
  },
  {
    name: "press_key",
    description: "Press a keyboard key (enter, delete, escape, tab, or any character)",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", description: "Key to press" } },
      required: ["key"],
    },
  },
  {
    name: "press_button",
    description: "Press a device button (home, lock, siri, apple_pay)",
    inputSchema: {
      type: "object",
      properties: {
        udid: { type: "string", description: "Simulator UDID (optional)" },
        button: { type: "string", description: "Button: home, lock, siri, apple_pay" },
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
      properties: { udid: { type: "string", description: "Simulator UDID (optional)" } },
    },
  },
  {
    name: "get_screen_size",
    description: "Get the simulator screen dimensions",
    inputSchema: {
      type: "object",
      properties: { udid: { type: "string", description: "Simulator UDID (optional)" } },
    },
  },
  {
    name: "describe_screen",
    description: "Get accessibility tree of the current screen (useful for finding tap targets)",
    inputSchema: {
      type: "object",
      properties: { udid: { type: "string", description: "Simulator UDID (optional)" } },
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
  {
    name: "find_elements",
    description: "Find UI elements by label (case-insensitive partial match)",
    inputSchema: {
      type: "object",
      properties: {
        udid: { type: "string", description: "Simulator UDID (optional)" },
        label: { type: "string", description: "Label to search for" },
      },
      required: ["label"],
    },
  },
  {
    name: "tap_element",
    description: "Find an element by label and tap it",
    inputSchema: {
      type: "object",
      properties: {
        udid: { type: "string", description: "Simulator UDID (optional)" },
        label: { type: "string", description: "Label of element to tap" },
      },
      required: ["label"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

// Helper to get UDID
async function getUdid(providedUdid?: string): Promise<string> {
  if (providedUdid) return providedUdid;
  const booted = await idb.getBootedSimulator();
  if (!booted) throw new Error("No booted simulator found. Provide a UDID or boot a simulator.");
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
