/**
 * Loads system prompts for Júlia and Helena from `server/prompts/<agent>.md`.
 * Source-of-truth files have YAML frontmatter + sections. We extract the
 * block under "## System Prompt" up to the next "## " heading.
 *
 * Cached in-memory after first load — prompts are static at runtime.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AgentName = "julia" | "helena";

export interface PromptMetadata {
  agent_id?: string;
  agent_name?: string;
  cargo?: string;
  modelo?: string;
  stack?: string;
  janela?: string;
  versao?: string;
  ultima_atualizacao?: string;
  [key: string]: string | undefined;
}

export interface LoadedPrompt {
  metadata: PromptMetadata;
  /** Raw extracted system prompt (without the fenced code block delimiters). */
  systemPrompt: string;
}

const _cache = new Map<AgentName, LoadedPrompt>();

// `import.meta.url` works in ESM. Build output is CJS — `script/build.ts` bundles
// these prompts into the binary OR they live alongside in `server/prompts/`.
// In dev (`tsx`) we resolve relative to this file's location.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function promptsDir(): string {
  return resolve(__dirname, "..", "prompts");
}

function parseFrontmatter(raw: string): { metadata: PromptMetadata; body: string } {
  // Frontmatter format:
  //   ---\n
  //   key: value\n
  //   ...\n
  //   ---\n
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) return { metadata: {}, body: raw };

  const metadata: PromptMetadata = {};
  const lines = fmMatch[1].split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    metadata[m[1]] = value;
  }
  return { metadata, body: fmMatch[2] };
}

function extractSystemPromptSection(body: string): string {
  // Find "## System Prompt" (heading line) and capture content until next "## ".
  const lines = body.split(/\r?\n/);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+System Prompt/i.test(lines[i])) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) {
    throw new Error("Prompt file missing '## System Prompt' section");
  }
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  const section = lines.slice(startIdx, endIdx).join("\n").trim();

  // The section commonly wraps the prompt in a fenced code block (``` ... ```).
  // Strip the fences if present so the model receives the raw instructions.
  const fenced = section.match(/^```[A-Za-z0-9_-]*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (fenced) return fenced[1].trim();
  return section;
}

export function loadPrompt(agentName: AgentName): LoadedPrompt {
  const cached = _cache.get(agentName);
  if (cached) return cached;

  const path = resolve(promptsDir(), `${agentName}.md`);
  const raw = readFileSync(path, "utf-8");
  const { metadata, body } = parseFrontmatter(raw);
  const systemPrompt = extractSystemPromptSection(body);

  const loaded: LoadedPrompt = { metadata, systemPrompt };
  _cache.set(agentName, loaded);
  return loaded;
}

/** Test helper: clears the prompt cache. */
export function _resetPromptCache(): void {
  _cache.clear();
}
