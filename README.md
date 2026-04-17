# sveltekit-agent-demo

A minimal [SvelteKit](https://kit.svelte.dev/) app that streams a multi-step chat agent with [Vercel AI SDK](https://sdk.vercel.ai/) (`streamText`) and [Google Vertex AI](https://cloud.google.com/vertex-ai) (Gemini). The browser UI uses [`@ai-sdk/svelte`](https://ai-sdk.dev/docs/reference/ai-sdk-ui/chat) (`Chat`) against a single `POST /api/chat` route.

## Features

- **Streaming chat** with tool calls, collapsible tool args/results, optional model reasoning, and tagged `<thinking>...</thinking>` blocks parsed for the UI.
- **Document Q&A** via `answerFromImages`: embeds the question in [Pinecone](https://www.pinecone.io/), fetches matching PDF page images, then answers with a Vertex vision model; the client can render **highlight overlays** on page images and a **Sources** section when the assistant lists citations.
- **Calculator** and **unit converter** tools for numeric tasks.
- **Maps grounding** via Vertex’s native **`googleMaps`** provider tool when you enable **“Use Google Maps grounding for this message”** in the UI (or send JSON **`useMapsForMessage`: `true`** on `POST /api/chat`). That turn uses **only** `googleMaps` so Vertex does not mix provider tools with function tools. Default turns use document / calculator / unit tools only. Optional: **`mapsLatLng`** / **`retrievalLatLng`** as `{ "latitude": number, "longitude": number }` for `providerOptions.vertex.retrievalConfig.latLng` ([Maps grounding on Vertex](https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-maps)).
- Light/dark theme toggle (persists in `localStorage`).

## Requirements

- **Node.js** (recent LTS recommended).
- A **Google Cloud** project with Vertex AI enabled and credentials the server can use (typically `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account JSON file, or Application Default Credentials in your environment).
- A **Pinecone** API key and an index populated with your document image embeddings (namespaces and index defaults are configurable; see below).

## Setup

1. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file in the project root (SvelteKit loads private env vars from here). At minimum you need:

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `GOOGLE_PROJECT_ID` or `GOOGLE_VERTEX_PROJECT` | Yes (one of) | GCP project ID for Vertex (`src/lib/agent.ts` and `src/lib/tools.ts`). |
   | `GOOGLE_LOCATION`, `GOOGLE_LOCATION_REGION`, or `GOOGLE_VERTEX_LOCATION` | No | Vertex region; empty or `global` becomes `us-central1`. |
   | `GOOGLE_APPLICATION_CREDENTIALS` | Usually | Path to the service account JSON (relative paths resolve from `process.cwd()`). |
   | `PINECONE_API_KEY` | Yes (for document tools) | Pinecone API key. |
   | `PINECONE_INDEX` or `PINECONE_INDEX_NAME` | No | Index name (code default: `pdf-image-upsert`). |
   | `PINECONE_NAMESPACE` | No | Namespace (code default: `AAA_UPSERT_TEST`). |
   | `PINECONE_TOP_K` | No | Number of matches to retrieve (default: `3`). |

3. Optional tuning:

   | Variable | Description |
   |----------|-------------|
   | `AGENT_MODEL` | Vertex model id for the main chat loop (default: `gemini-2.5-flash`). |
   | `GEMINI_MODEL` | Vision model used inside document tools (default: `gemini-2.5-flash`). |
   | `AGENT_FEEDBACK` | Set to `false` to reduce console feedback from agent tools. |
   | `AGENT_VERBOSE_RETRIEVAL` | Set to `true` to log full Pinecone results to stderr. |

4. Run the dev server:

   ```bash
   npm run dev
   ```

   Open the URL Vite prints (typically `http://localhost:5173`).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite in dev mode with the SvelteKit server. |
| `npm run build` | Production build. |
| `npm run preview` | Preview the production build locally. |

## Project layout

- `src/routes/+page.svelte` — Chat UI, markdown rendering, tool and source display, PDF highlight viewer.
- `src/routes/api/chat/+server.ts` — Accepts `{ messages }` (AI SDK `UIMessage[]`), runs `streamText` with `stopWhen: stepCountIs(8)`, returns `toUIMessageStreamResponse`.
- `src/lib/agent.ts` — Vertex model factory, system prompt, and the tool set wired into `streamText`.
- `src/lib/tools.ts` — Builds `AgentToolsConfig` from `$env/dynamic/private`, constructs the stack/logger context, and composes tools via `createAllAgentTools` / `createChatAgentTools`.
- `src/lib/agent-tools/` — Framework-agnostic retrieval, vision, and tool implementations.

## API

**`POST /api/chat`**

- **Body:** JSON `{ "messages": UIMessage[] }` (same shape the AI SDK Svelte `Chat` client sends).
- **Response:** UI message stream compatible with `@ai-sdk/svelte`.

Invalid JSON or a missing `messages` array yields `400` with `{ "error": "..." }`.

## Additional documentation

See `docs/CHAT_REPRODUCTION_GUIDE.md` for deeper notes on reproducing or debugging chat behavior.

## License

Private package (`"private": true` in `package.json`). Add a license file if you intend to distribute the project.
