<div align="center">
  <h1>Agentic Inbox</h1>
  <p><em>A self-hosted email client with an AI agent, hosted on Cloudflare Workers</em></p>
</div>

Agentic Inbox lets you send, receive, and manage emails through a modern web interface -- all powered by your own Cloudflare account. Incoming emails arrive via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/), each mailbox is isolated in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) with a SQLite database, and attachments are stored in [R2](https://developers.cloudflare.com/r2/).

An **AI-powered Email Agent** can read your inbox, search conversations, and draft replies -- built with the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/), using Workers AI or your own OpenAI-compatible gateway.

This is an independent fork of [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox). It adds structured summaries on arrival, AI titles, a unified mailbox view, scoped search, virtual scrolling, and email privacy controls. Interface labels are English; generated summaries and titles are Chinese.

## Differences from upstream

Compared with upstream [`48039bb`](https://github.com/cloudflare/agentic-inbox/commit/48039bb6785af34e592c2966f87cde2b255c4c80), checked on October 9, 2026. See the [full diff](https://github.com/nexmoe/agentic-inbox/compare/48039bb6785af34e592c2966f87cde2b255c4c80...main).

| Area | Official version | This fork |
| --- | --- | --- |
| Arrival summaries | Automatic reply drafts; no saved summary or AI title. | A durable Agent task summarizes the full saved conversation on receipt, even with the app closed. Viewing a message reads the cached result. |
| Structured information | Read the original message or ask the Agent. | Chinese summaries contain 1–3 key points, copyable verification codes, and labeled action links extracted from the email. Link destinations and codes are checked against the source. |
| List titles | Original subject and body preview. | A short AI title replaces the subject and preview. The original subject remains the fallback and is preserved in details. |
| Mailbox navigation | Open a mailbox from the Mailboxes page. | A dropdown switches directly between mailboxes and **All mail**. Inbox, Sent, Drafts, Archive, and Trash can combine messages from every mailbox. Actions keep their source mailbox. |
| Lists and unread state | Button pagination and per-mailbox conversation lists. | Infinite virtual scrolling loads more messages near the end and renders visible rows. Server-side **All mail / Unread** filters cover the full result set; conversation unread counts use the current folder. |
| Search | Per-mailbox search across subjects, bodies, and addresses. | Search is available in the list and follows the selected scope: all mailboxes in **All mail**, or the current mailbox. It also matches AI titles and loads further results while scrolling. |
| Reading layout | A reserved detail pane; opening a thread expands its newest message, which can be a draft. | The list fills the remaining width until selection. The detail pane animates open and closed; **Close mail** is the leftmost toolbar action. The selected message expands even when a newer draft exists. |
| Interface | Original Kumo layout. | Equal-height headers, matching sidebar margins, Fluid Functionalism controls, Inter variable font, and reduced-motion support. Message counts sit below the folder title; the list has no footer or refresh button. List text is left-aligned; stars move to the detail menu. No outer page frame. |
| Addresses and logos | Sender labels and initials. | Full sender and recipient addresses share a line, each with a small bordered favicon.im logo. Mailbox choices and message details also show domain logos, with initials on failure. Recipient addresses use neutral text. |
| Email links | HTML email links keep sender-provided targets. | Rendered HTML, plain-text, and summary web links open new tabs with `noopener noreferrer`. Known analytics parameters are removed; signed URL queries are preserved. |
| Remote content | Sanitized, sandboxed HTML; HTTPS images can load. | Remote images and remote CSS resources are blocked by default. **Load images** allows HTTPS images for that message while known tracking endpoints and hidden pixels remain blocked. A nonce restricts iframe scripts to the height reporter. |
| Receiving and forwarding | Match configured recipients against the email's To header. | Route by the SMTP recipient, including CC/BCC delivery. Optional domain catch-alls collect aliases in an existing mailbox, labeled `*@example.com`. Optional external copies are configured separately and can be disabled with `{}`. |
| AI providers | Workers AI with `@cf/moonshotai/kimi-k2.5` configured. | Workers AI defaults to `@cf/zai-org/glm-4.7-flash`; an OpenAI-compatible gateway can handle every AI feature, including safety checks. GLM-5.3 uses low reasoning effort, JSON mode with schema instructions, and local validation. Gateway errors never fall back to Workers AI. |
| Deployment and checks | Wrangler configuration, React Router 7, and Vite 6. | cf CLI, `cloudflare.config.ts`, ignored local deployment settings, React Router 8, and Vite 7. Automated tests cover receiving, summaries, gateways, unread filters, aggregate lists, search, scrolling data, and link privacy. |

The original composer, automatic reply drafts, mailbox Durable Objects, R2 attachments, MCP tools, and shared Cloudflare Access policy remain. **All mail** is an aggregate view, not a new mailbox or a new authorization boundary.

![Agentic Inbox screenshot](./demo_app.png)

*Upstream screenshot; this fork's interface differs.*

Read the blog post to learn more about Cloudflare Email Service and how to use it with the Agents SDK, MCP, and from the Wrangler CLI: [Email for Agents](https://blog.cloudflare.com/email-for-agents/).

## How to setup

Use the cf CLI workflow in **Getting Started** below. The application also needs Cloudflare Access and Email Routing.

### To set up

1. Configure `.cloudflare/deployment.json` and deploy with `npm run deploy`. cf provisions the configured R2 bucket and Durable Objects.
2. **Configure Cloudflare Access** -- Enable [one-click Cloudflare Access](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/) on your Worker under Settings > Domains & Routes. The modal will show your `POLICY_AUD` and `TEAM_DOMAIN` values. `TEAM_DOMAIN` can be either your Access team URL or the full `.../cdn-cgi/access/certs` URL. **You must set these as secrets for your Worker.**
3. **Set up Email Routing** -- Enable routing for each mail domain and point rules for your configured addresses to this Worker. Verify any forwarding destinations.
4. **Create a mailbox** -- Visit your deployed app and create mailboxes for the addresses listed in `emailAddresses`.
5. **Optional sending** -- Configure [Email Service](https://developers.cloudflare.com/email-service/) if you need outbound mail. Receiving, forwarding, and summaries work independently.

### Troubleshooting Access

1. If you see `Invalid or expired Access token`, that usually means `POLICY_AUD` or `TEAM_DOMAIN` secrets are incorrect.
   * Resolution: [turn Access off and back on for the Worker to get the Access modal again](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/), then reset your Worker secrets to the latest `POLICY_AUD` and `TEAM_DOMAIN` values shown there.
2. If you see `Cloudflare Access must be configured in production`, this application is intentionally enforcing Cloudflare Access so your inbox is not exposed to anyone on the internet.
   * Resolution: enable Access using [one-click Cloudflare Access for Workers](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/), then set the `POLICY_AUD` and `TEAM_DOMAIN` Worker secrets from the modal values.

## Core features

- **Full email client** — Send and receive emails via Cloudflare Email Routing with a rich text composer, reply/forward threading, folder organization, search, and attachments
- **Per-mailbox isolation** — Each mailbox runs in its own Durable Object with SQLite storage and R2 for attachments
- **Built-in AI agent** — Side panel with 9 email tools for reading, searching, drafting, and organizing
- **Auto-draft on new email** — Agent automatically reads inbound emails and generates draft replies, always requiring explicit confirmation before sending
- **Configurable and persistent** — Custom system prompts per mailbox, persistent chat history, streaming markdown responses, and tool call visibility

## Stack

- **Frontend:** React 19, React Router v8, Tailwind CSS, Zustand, TipTap, `@cloudflare/kumo`, Fluid Functionalism (Base UI)
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing
- **AI Agent:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI or `@ai-sdk/openai-compatible`, `react-markdown` + `remark-gfm`
- **Auth:** Cloudflare Access JWT validation (required outside local development)

## Getting Started

```bash
npm install
mkdir -p .cloudflare
cp deployment.example.json .cloudflare/deployment.json
# Edit the local deployment settings before starting or deploying.
npm run dev
```

### Configuration

1. Copy `deployment.example.json` to `.cloudflare/deployment.json` and set your account, web domain, mail domains, addresses, and optional forwarding destinations. This local file is ignored by Git.
2. Authenticate with `npx cf auth login`.
3. `cf deploy` creates the configured R2 bucket and SQLite Durable Objects.
4. Configure Email Routing and Cloudflare Access. Set `POLICY_AUD` and `TEAM_DOMAIN` as Worker secrets.

With `aiProvider: "workers-ai"` (the default), the `AI` binding uses Workers AI directly; no external API key is needed. `aiModel` selects the model for chat, automatic reply drafts, and summaries. The default is `@cf/zai-org/glm-4.7-flash`. Prompt injection checks and draft review also use Workers AI and share the account's daily allocation.

To use your own OpenAI-compatible gateway, set these fields in the ignored `.cloudflare/deployment.json`:

```json
{
  "aiProvider": "openai-compatible",
  "aiBaseUrl": "https://api.example.com/v1",
  "aiModel": "your-model-id",
  "aiPreviousModels": ["@cf/zai-org/glm-4.7-flash"]
}
```

Set `AI_API_KEY` as an encrypted Worker secret before deploying; for local development, use `.dev.vars`. The gateway model handles summaries, chat, automatic drafts, prompt injection checks, and draft review. It must support Chat Completions, streaming, tool calls, and structured JSON outputs. Authentication and upstream errors never fall back to Workers AI. `aiPreviousModels` keeps unchanged summaries from up to five earlier models readable without generation; explicit regeneration uses the new model. Gateway credentials stay on the server and are never returned by the app API.

`Z-AI/GLM-5.3-Flash` is supported through a compatible gateway. Its adapter enables low-effort reasoning and uses JSON mode. GLM summary requests also include the complete JSON schema in the system instructions, since JSON mode does not enforce field constraints. Markdown fences around JSON are removed locally; malformed JSON and invalid fields still fail validation without an extra model call. Chat formatting is unchanged. Gateway mode sends email content needed by the selected AI feature to that gateway and uses its quota.

Gateway summaries and draft safety checks have a 180-second deadline per model request; Workers AI retains its 25-second deadline. The summary UI waits up to 190 seconds for a manual request. Automatic summaries keep their existing two-attempt limit and cached summaries remain read-only when opened. Timeouts show a specific error rather than a generic generation failure.

Gateway diagnostics record the feature, HTTP status, elapsed time, error category, and output size/token counts when validation fails. They never log email bodies, model output, API keys, request headers, or upstream error messages. Use these diagnostics to distinguish timeouts, empty output, invalid JSON, and invalid fields; previously failed messages require an explicit retry.

### Summaries and titles

Summaries use the complete text of all saved messages in the thread, excluding unsent drafts. Attachment names and metadata are included; attachment contents are not read. Input over 80,000 characters returns a visible error. Each mailbox allows two concurrent summary generations. A durable task starts on receipt and makes at most two attempts on transient errors. Automatic drafts run independently.

The same structured response includes a title of at most 32 characters, saved separately from the original subject. Lists never call AI. Reopening unchanged emails reads the persisted Agent cache. Use **Generate summary** for historical messages, **Retry** after a failure, or **Update summary** to upgrade an older unstructured summary. Switching providers can preserve old caches through `aiPreviousModels`.

### Search and scrolling

The search field follows the mailbox selector. **All mail** searches all mailboxes; choosing a mailbox restricts the same query to that mailbox. Search covers the subject, AI title, body, sender, recipient, CC, and BCC, with the existing advanced filters.

Mail lists and search results use infinite virtual scrolling instead of page buttons. The unified APIs use bounded keyset pagination across mailbox Durable Objects, so new arrivals do not shift later pages. Individual mailbox APIs retain page-based requests behind the scrolling UI. Cloudflare Access protects the aggregate APIs under the same policy as individual mailboxes.

### Email privacy

Remote images stay blocked until **Load images** is selected for that message. Hidden pixels, known tracking image URLs, and remote CSS resources remain blocked. Authenticated CID attachments are embedded as image bytes. Tracker detection uses simple rules; it is not a complete tracker database. Loading remote images or opening a link contacts the destination.

Email web links open in new tabs without an opener or referrer. Common analytics parameters, such as `utm_*`, are removed. Other query values and signed URLs are preserved. Domain logos are fetched separately from favicon.im using the email domain, not the full address.

```bash
npm test
npm run typecheck
```

### Deploy

```bash
npm run deploy
```

This checkout uses cf CLI 1.0 beta, Vite 7, and React Router 8. Use Node.js 22.22 or newer.
The Vite build includes a `build/client` alias so React Router can read assets from cf's Build Output directory.

### Catch-all receiving

To receive every address at a domain in one existing mailbox, set `emailCatchAll` in the local `.cloudflare/deployment.json`:

```json
{
  "emailAddresses": ["team@example.com"],
  "emailCatchAll": { "example.com": "team@example.com" },
  "emailForwarding": {}
}
```

Create the target mailbox, deploy, and enable the domain's Email Routing catch-all rule with **Send to a Worker → agentic-inbox**. Aliases use the SMTP recipient's domain and are stored in the configured mailbox. They keep the original message headers and share that mailbox's Agent; no extra mailboxes are created. Catch-all targets must be in `emailAddresses`. An empty `emailForwarding` disables automatic external copies.

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- [Email Service](https://developers.cloudflare.com/email-service/) enabled for sending
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled, or an OpenAI-compatible gateway and API key (for AI features)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) configured for deployed/shared environments (required in production)

Any user who passes the shared Cloudflare Access policy can access all mailboxes in this app by design. This includes the MCP server at `/mcp` -- external AI tools (Claude Code, Cursor, etc.) connected via MCP can operate on any mailbox by passing a `mailboxId` parameter. There is no per-mailbox authorization; the Cloudflare Access policy is the single trust boundary.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────>│  Hono Worker     │────>│  MailboxDO      │
│  React SPA   │     │  (API + SSR)     │     │  (SQLite + R2)  │
│  Agent Panel │     │                  │     └─────────────────┘
└──────┬───────┘     │  /agents/* ──────┼────>┌─────────────────┐
       │             │                  │     │  EmailAgent DO  │
       │ WebSocket   │                  │     │  (AIChatAgent)  │
       └─────────────┤                  │     │  9 email tools  │
                     │                  │────>│  AI provider    │
                     └──────────────────┘     └─────────────────┘
```

The AI provider is Workers AI or the configured OpenAI-compatible gateway. A durable receipt task generates and caches summaries; the unified list and search query mailbox Durable Objects through the Worker API.

## License

Apache 2.0 -- see [LICENSE](LICENSE).
