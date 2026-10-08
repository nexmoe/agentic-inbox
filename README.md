<div align="center">
  <h1>Agentic Inbox</h1>
  <p><em>A self-hosted email client with an AI agent, running entirely on Cloudflare Workers</em></p>
</div>

Agentic Inbox lets you send, receive, and manage emails through a modern web interface -- all powered by your own Cloudflare account. Incoming emails arrive via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/), each mailbox is isolated in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) with a SQLite database, and attachments are stored in [R2](https://developers.cloudflare.com/r2/).

An **AI-powered Email Agent** can read your inbox, search conversations, and draft replies -- built with the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) and [Workers AI](https://developers.cloudflare.com/workers-ai/).

This fork generates Chinese summaries as soon as an email arrives and adds a unified view of every mailbox. Summaries appear above the message body and cover the full conversation.

![Agentic Inbox screenshot](./demo_app.png)


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

## Features

- **Full email client** — Send and receive emails via Cloudflare Email Routing with a rich text composer, reply/forward threading, folder organization, search, and attachments
- **Per-mailbox isolation** — Each mailbox runs in its own Durable Object with SQLite storage and R2 for attachments
- **Built-in AI agent** — Side panel with 9 email tools for reading, searching, drafting, and organizing
- **Auto-draft on new email** — Agent automatically reads inbound emails and generates draft replies, always requiring explicit confirmation before sending
- **Auto-summary on arrival** — Receiving an email schedules the mailbox Agent to summarize the full body and conversation in Chinese, even while the app is closed. Opening details reads the saved summary. Failed requests and historical emails offer a manual generation button.
- **Unified mailbox view** — The **全部邮件** entry on the home page and mailbox sidebar combines all inboxes in one list, newest first. Each row shows its mailbox. Details, read status, stars, replies, and drafts use that mailbox. Sent, drafts, archive, and trash can also be viewed across mailboxes.
- **Configurable and persistent** — Custom system prompts per mailbox, persistent chat history, streaming markdown responses, and tool call visibility

## Stack

- **Frontend:** React 19, React Router v8, Tailwind CSS, Zustand, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing
- **AI Agent:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI (`@cf/zai-org/glm-4.7-flash`), `react-markdown` + `remark-gfm`
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

The `AI` binding uses Workers AI directly; no external API key is needed.
`AI_MODEL` selects the model for chat, automatic reply drafts, and summaries. The default is
`@cf/zai-org/glm-4.7-flash`, which supports tool calling within the Workers AI free allocation.
Prompt injection checks and draft review also use Workers AI and share the account's daily allocation.

Summaries use the complete text of all saved messages in the thread, excluding unsent drafts. Attachment names and metadata are included; attachment contents are not read. Conversations over 80,000 characters return a visible error rather than a partial summary. Each mailbox allows two concurrent summary generations, with a 25-second model timeout. A durable task starts on receipt and makes at most two attempts on transient errors. Automatic drafts run independently. Reopening unchanged emails reads the persisted Agent cache without another model call. Existing emails without a summary can be summarized manually.

The unified list uses bounded keyset pagination across mailbox Durable Objects. New arrivals do not shift later pages. Cloudflare Access protects the aggregate API under the same policy as individual mailboxes.

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

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- [Email Service](https://developers.cloudflare.com/email-service/) enabled for sending
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled (for the agent)
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
                     │                  │────>│  Workers AI     │
                     └──────────────────┘     └─────────────────┘
```

## License

Apache 2.0 -- see [LICENSE](LICENSE).
