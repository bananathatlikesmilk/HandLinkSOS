## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: prettier, eslint, playwright, tailwindcss, better-auth, drizzle, ai-tools, experimental

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## Persistent project context and discussion history

The user shares these records with ChatGPT on their phone:

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) is the current project overview: architecture, confirmed features, rules, decisions, known problems, progress, and open work.
- [CODEX_HISTORY.md](CODEX_HISTORY.md) is the chronological discussion record: important user questions, explanations, decisions, changes, verification, and unresolved questions.

At the start of relevant work, read the current context and the history entries relevant to the task. Verify important implementation claims against source. These documents are memory aids, not substitutes for current code or higher-priority instructions.

After meaningful implementation, debugging, deployment discussions, architecture decisions, or teaching sessions:

1. Update affected sections of PROJECT_CONTEXT.md to describe the current confirmed state. Mark proposed work, reported symptoms, and unverified deployment separately.
2. Append an entry to CODEX_HISTORY.md before the final response. Include a stable entry ID, the date when known, the user's question or objective, the explanation or reasoning, decisions, changes, actual verification, and outstanding work. Record conceptual lessons and corrected misunderstandings, not only code changes.
3. Preserve prior information and chronological entries. Correct a mistaken historical claim with a clearly identified correction or superseding entry. Preserve attribution and provenance. Redact any discovered secret immediately rather than retaining it for historical completeness.
4. Distinguish source inspection, user reports, earlier assistant reports, tool results, and proposals. Do not invent missing conversations, exact dates, tests, deployments, or successful outcomes. Use "earlier, date unavailable" when appropriate.
5. Keep the records useful for a reader without this chat: explain terms, connect related files, use repository-relative links, and state material limitations. The user prefers plain, digestible explanations, small examples, and code questions they can answer during defense practice.
6. In the final response, mention which context files changed when relevant. Do not change application behavior merely to maintain documentation. Documentation-only work does not require running the application test suites.

Never copy credentials or private records into these documents. Exclude passwords, mail app passwords, API keys, private keys, authentication/session/QR/push/tunnel tokens, service-account JSON contents, actual medical records, database dumps, and unrelated personal files. Environment variable names and public configuration concepts are allowed; secret values and credential file paths are not. Do not read .env, credential JSON, or real database rows just to populate project memory. Previously exposed credentials may be described as an unresolved security concern without reproducing their values.

Local edits, local commits, GitHub publishing, container deployment, APK packaging, and physical-device verification are different states. Record each only when evidence supports it. Do not commit, push, deploy, contact someone, or rotate credentials merely because these maintenance instructions exist.

For library/framework/API documentation, use Context7 when available: resolve the library ID first, then query the relevant concept. General business-logic explanations and repository inspection do not require an external documentation lookup. Preserve the Svelte guidance above; if a required tool is unavailable, report that limitation rather than claiming it ran.
