import { bindings, defineConfig, defineWorker, exports } from "cf/config";
import type { DurableObjectCreatedExport } from "cf/config";
import { existsSync, readFileSync } from "node:fs";
import * as entrypoint from "./workers/app" with { type: "cf-worker" };

interface DeploymentSettings {
	accountId?: string;
	webDomain?: string;
	domains: string[];
	emailAddresses: string[];
	emailCatchAll: Record<string, string>;
	emailForwarding: Record<string, string>;
	aiProvider: "workers-ai" | "openai-compatible";
	aiBaseUrl: string;
	aiModel: string;
	aiPreviousModels: string[];
}

const localSettingsPath = ".cloudflare/deployment.json";
const deployment: DeploymentSettings = {
	domains: ["example.com"],
	emailAddresses: ["team@example.com"],
	emailCatchAll: {},
	emailForwarding: {},
	aiProvider: "workers-ai",
	aiBaseUrl: "",
	aiModel: "@cf/zai-org/glm-4.7-flash",
	aiPreviousModels: [],
	...(existsSync(localSettingsPath) ? JSON.parse(readFileSync(localSettingsPath, "utf8")) : {}),
};

const sqliteObject: DurableObjectCreatedExport = exports.durableObject({ storage: "sqlite" });

const worker = defineWorker({
	name: "agentic-inbox",
	entrypoint,
	compatibilityDate: "2025-11-28",
	exports: {
		MailboxDO: sqliteObject,
		EmailAgent: sqliteObject,
		EmailMCP: sqliteObject,
	},
});

export default defineConfig({
	accountId: deployment.accountId,
	worker: {
		...worker,
		compatibilityFlags: ["nodejs_compat"],
		workersDev: true,
		domains: deployment.webDomain ? [deployment.webDomain] : [],
		observability: { enabled: true },
		env: {
			DOMAINS: bindings.text(deployment.domains.join(",")),
			EMAIL_ADDRESSES: bindings.json(deployment.emailAddresses),
			EMAIL_CATCH_ALL: bindings.json(deployment.emailCatchAll),
			EMAIL_FORWARDING: bindings.json(deployment.emailForwarding),
			POLICY_AUD: bindings.secret(),
			TEAM_DOMAIN: bindings.secret(),
			BUCKET: bindings.r2({ name: "agentic-inbox" }),
			EMAIL: bindings.sendEmail({ dev: { remote: true } }),
			MAILBOX: bindings.durableObject<typeof worker, "MailboxDO">({ worker, exportName: "MailboxDO" }),
			EMAIL_AGENT: bindings.durableObject<typeof worker, "EmailAgent">({ worker, exportName: "EmailAgent" }),
			EMAIL_MCP: bindings.durableObject<typeof worker, "EmailMCP">({ worker, exportName: "EmailMCP" }),
			AI: bindings.ai(),
			AI_PROVIDER: bindings.text(deployment.aiProvider),
			AI_BASE_URL: bindings.text(deployment.aiBaseUrl),
			AI_MODEL: bindings.text(deployment.aiModel),
			AI_PREVIOUS_MODELS: bindings.json(deployment.aiPreviousModels),
			...(deployment.aiProvider === "openai-compatible" ? { AI_API_KEY: bindings.secret() } : {}),
		},
	},
});
