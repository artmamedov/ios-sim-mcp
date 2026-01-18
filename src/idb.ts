import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

// Find idb executable
function findIdb(): string {
  if (process.env.IDB_PATH) {
    return process.env.IDB_PATH;
  }

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

  return "idb";
}

const IDB = findIdb();

// Execute idb command
export async function idb(args: string): Promise<string> {
  const { stdout, stderr } = await execAsync(`${IDB} ${args}`);
  if (stderr && !stdout) {
    throw new Error(stderr);
  }
  return stdout.trim();
}

// Types
export interface Simulator {
  udid: string;
  name: string;
  state: string;
  type: string;
  os_version: string;
}

export interface UIElement {
  type: string;
  label: string | null;
  value: string | null;
  frame: { x: number; y: number; width: number; height: number };
  enabled: boolean;
}

export interface ScreenSize {
  pixels: { width: number; height: number };
  points: { width: number; height: number };
  scale: number;
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

// Parse raw idb element to our format
function parseElement(raw: any): UIElement & { children?: any[] } {
  return {
    type: raw.type || raw.role || "Unknown",
    label: raw.AXLabel || null,
    value: raw.AXValue || null,
    frame: raw.frame || { x: 0, y: 0, width: 0, height: 0 },
    enabled: raw.enabled ?? true,
    children: raw.children?.map(parseElement),
  };
}

// Flatten element tree to list
function flattenElements(elements: any[], result: UIElement[] = []): UIElement[] {
  for (const el of elements) {
    if (el.label || ["Button", "TextField", "StaticText", "Image", "Switch", "Slider", "Application"].includes(el.type)) {
      const { children, ...rest } = el;
      result.push(rest);
    }
    if (el.children) {
      flattenElements(el.children, result);
    }
  }
  return result;
}

// Simulator operations
export async function listSimulators(): Promise<Simulator[]> {
  const output = await idb("list-targets");
  return parseListTargets(output);
}

export async function getBootedSimulator(): Promise<Simulator | null> {
  const simulators = await listSimulators();
  return simulators.find((s) => s.state === "Booted") || null;
}

// Helper for actionable error when no booted simulator
export function noBootedSimulatorError(): Error {
  return new Error(
    "No booted simulator found. Use list_simulators to find available simulators, then boot_simulator with a UDID."
  );
}

export async function bootSimulator(udid: string): Promise<string> {
  await idb(`boot --udid ${udid}`);
  return `Booted simulator ${udid}`;
}

export async function shutdownSimulator(udid: string): Promise<string> {
  await idb(`shutdown --udid ${udid}`);
  return `Shut down simulator ${udid}`;
}

// Screenshot
export async function takeScreenshot(udid: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `sim-screenshot-${Date.now()}.png`);
  await idb(`screenshot ${tmpFile} --udid ${udid}`);
  const imageData = fs.readFileSync(tmpFile);
  const base64 = imageData.toString("base64");
  fs.unlinkSync(tmpFile);
  return base64;
}

// App operations
export async function launchApp(udid: string, bundleId: string): Promise<string> {
  await idb(`launch ${bundleId} --udid ${udid}`);
  return `Launched ${bundleId}`;
}

export async function terminateApp(udid: string, bundleId: string): Promise<string> {
  await idb(`terminate ${bundleId} --udid ${udid}`);
  return `Terminated ${bundleId}`;
}

export async function listApps(udid: string): Promise<string> {
  return await idb(`list-apps --udid ${udid}`);
}

// UI interactions
export async function tap(udid: string, x: number, y: number): Promise<string> {
  await idb(`ui tap ${x} ${y} --udid ${udid}`);
  return `Tapped at (${x}, ${y})`;
}

export async function swipe(
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

export async function typeText(udid: string, text: string): Promise<string> {
  const escaped = text.replace(/'/g, "'\\''");
  await idb(`ui text '${escaped}' --udid ${udid}`);
  return `Typed: ${text}`;
}

export async function pressKey(udid: string, keycode: number): Promise<string> {
  await idb(`ui key ${keycode} --udid ${udid}`);
  return `Pressed key: ${keycode}`;
}

export async function pressButton(udid: string, button: string): Promise<string> {
  const validButtons = ["apple_pay", "home", "lock", "side_button", "siri"];
  const normalizedButton = button.toLowerCase();
  if (!validButtons.includes(normalizedButton)) {
    throw new Error(
      `Invalid button '${button}'. Valid options: home (go to home screen), lock (toggle screen lock), siri (activate Siri), apple_pay (trigger Apple Pay).`
    );
  }
  await idb(`ui button ${button.toUpperCase()} --udid ${udid}`);
  return `Pressed button: ${button}`;
}

export async function openUrl(udid: string, url: string): Promise<string> {
  await idb(`open ${url} --udid ${udid}`);
  return `Opened URL: ${url}`;
}

// Accessibility
export async function describeScreen(udid: string): Promise<UIElement[]> {
  const output = await idb(`ui describe-all --nested --udid ${udid}`);
  const raw = JSON.parse(output);
  const parsed = Array.isArray(raw) ? raw.map(parseElement) : [parseElement(raw)];
  return flattenElements(parsed);
}

export async function describePoint(udid: string, x: number, y: number): Promise<string> {
  return await idb(`ui describe-point ${x} ${y} --udid ${udid}`);
}

export async function findElements(udid: string, label: string): Promise<UIElement[]> {
  const elements = await describeScreen(udid);
  const lowerLabel = label.toLowerCase();
  return elements.filter(el => el.label?.toLowerCase().includes(lowerLabel));
}

export async function tapElement(udid: string, label: string): Promise<string> {
  const matches = await findElements(udid, label);
  if (matches.length === 0) {
    throw new Error(
      `No element found with label containing "${label}". Use describe_screen to see all available elements and their labels, or use find_elements to search with different text.`
    );
  }
  const el = matches[0];
  const centerX = Math.round(el.frame.x + el.frame.width / 2);
  const centerY = Math.round(el.frame.y + el.frame.height / 2);
  await idb(`ui tap ${centerX} ${centerY} --udid ${udid}`);
  return `Tapped "${el.label}" at (${centerX}, ${centerY})`;
}

// Screen size
export async function getScreenSize(udid: string): Promise<ScreenSize> {
  const tmpFile = path.join(os.tmpdir(), `sim-size-${Date.now()}.png`);
  await idb(`screenshot ${tmpFile} --udid ${udid}`);
  const { stdout } = await execAsync(`sips -g pixelWidth -g pixelHeight "${tmpFile}"`);
  fs.unlinkSync(tmpFile);

  const widthMatch = stdout.match(/pixelWidth: (\d+)/);
  const heightMatch = stdout.match(/pixelHeight: (\d+)/);
  const pixelWidth = widthMatch ? parseInt(widthMatch[1]) : 0;
  const pixelHeight = heightMatch ? parseInt(heightMatch[1]) : 0;

  const elements = await describeScreen(udid);
  const appElement = elements.find(e => e.type === "Application");
  const pointWidth = appElement?.frame.width || Math.round(pixelWidth / 3);
  const pointHeight = appElement?.frame.height || Math.round(pixelHeight / 3);

  return {
    pixels: { width: pixelWidth, height: pixelHeight },
    points: { width: pointWidth, height: pointHeight },
    scale: Math.round(pixelWidth / pointWidth),
  };
}
