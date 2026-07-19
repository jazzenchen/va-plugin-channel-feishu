/**
 * Feishu/Lark SDK wrapper.
 *
 * Thin layer over @larksuiteoapi/node-sdk that provides:
 *   - SDK client + WebSocket lifecycle
 *   - Bot identity probe
 *   - Send / edit / reply APIs
 *   - Interactive card send / update
 *
 * All methods use the Feishu REST API via the SDK client.
 * The WebSocket gateway is handled separately in gateway.ts.
 */

import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig } from "./protocol.js";
function plugLog(level: string, message: string): void {
  process.stderr.write(`[feishu-lark][${level}] ${message}\n`);
}

// Note: console.* are redirected to stderr in main.ts.

// ---------------------------------------------------------------------------
// Custom logger for Lark SDK. Never serialize request/response objects: Axios
// errors can retain outbound message bodies in config.data.
// ---------------------------------------------------------------------------

function serializeArgs(...loggerArgs: unknown[]): string {
  // LoggerProxy forwards the original arguments as one array argument.
  const args = loggerArgs.length === 1 && Array.isArray(loggerArgs[0])
    ? loggerArgs[0]
    : loggerArgs;

  return args.map((v) => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && "isAxiosError" in v) {
      const err = v as {
        code?: unknown;
        response?: { status?: unknown };
      };
      const parts = ["AxiosError"];
      if (err.code) parts.push(`code=${String(err.code)}`);
      if (err.response?.status) parts.push(`status=${String(err.response.status)}`);
      return parts.join(" | ");
    }
    if (v instanceof Error) return v.name;
    if (v == null || typeof v === "number" || typeof v === "boolean") return String(v);
    return "[object omitted]";
  }).join(" ");
}

const sdkLogger = {
  error: (...msg: unknown[]) => plugLog("error", `[lark-sdk] ${serializeArgs(...msg)}`),
  warn: (...msg: unknown[]) => plugLog("warn", `[lark-sdk] ${serializeArgs(...msg)}`),
  info: (...msg: unknown[]) => plugLog("info", `[lark-sdk] ${serializeArgs(...msg)}`),
  debug: (...msg: unknown[]) => plugLog("debug", `[lark-sdk] ${serializeArgs(...msg)}`),
  trace: (..._msg: unknown[]) => { /* suppress trace-level noise */ },
};

// ---------------------------------------------------------------------------
// Brand → SDK domain
// ---------------------------------------------------------------------------

const BRAND_DOMAIN: Record<string, Lark.Domain> = {
  feishu: Lark.Domain.Feishu,
  lark: Lark.Domain.Lark,
};

function resolveDomain(brand?: string): Lark.Domain {
  return BRAND_DOMAIN[brand ?? "feishu"] ?? Lark.Domain.Feishu;
}

function assertApiSuccess(
  response: { code?: number; msg?: string },
  operation: string,
): void {
  if (response.code !== undefined && response.code !== 0) {
    throw new Error(
      `Feishu ${operation} failed: ${response.msg || `code ${response.code}`}`,
    );
  }
}

import { buildMarkdownCard } from "./card/builder.js";

// ---------------------------------------------------------------------------
// FeishuClient
// ---------------------------------------------------------------------------

export class FeishuClient {
  private sdk: Lark.Client;
  private wsClient: Lark.WSClient | null = null;
  private config: FeishuConfig;

  botOpenId: string | undefined;
  botName: string | undefined;

  constructor(config: FeishuConfig) {
    this.config = config;
    this.sdk = new Lark.Client({
      appId: config.app_id,
      appSecret: config.app_secret,
      appType: Lark.AppType.SelfBuild,
      domain: resolveDomain(config.domain),
      logger: sdkLogger,
    });
  }

  // ---- Bot identity --------------------------------------------------------

  async probe(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await (this.sdk as any).request({
        method: "GET",
        url: "/open-apis/bot/v3/info",
        data: {},
      });
      if (res.code !== 0) {
        return { ok: false, error: `API error: ${res.msg || `code ${res.code}`}` };
      }
      const bot = res.bot || res.data?.bot;
      this.botOpenId = bot?.open_id;
      this.botName = bot?.app_name || bot?.bot_name;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---- WebSocket -----------------------------------------------------------

  /**
   * Start WebSocket event monitoring.
   * Returns a Promise that resolves when abortSignal fires.
   */
  async startWS(
    handlers: Record<string, (data: unknown) => Promise<unknown> | void>,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const dispatcher = new Lark.EventDispatcher({
      encryptKey: this.config.encrypt_key ?? "",
      verificationToken: this.config.verification_token ?? "",
    });
    dispatcher.register(handlers as any);

    if (this.wsClient) {
      try { this.wsClient.close({ force: true }); } catch { /* ignore */ }
      this.wsClient = null;
    }

    this.wsClient = new Lark.WSClient({
      appId: this.config.app_id,
      appSecret: this.config.app_secret,
      domain: resolveDomain(this.config.domain),
      loggerLevel: Lark.LoggerLevel.info,
      logger: sdkLogger,
    });

    // Patch: SDK handleEventData only handles type="event", card actions
    // come as type="card". Rewrite to "event" so EventDispatcher routes them.
    const ws = this.wsClient as any;
    const origHandle = ws.handleEventData?.bind(ws);
    if (origHandle) {
      ws.handleEventData = (data: any) => {
        const msgType = data.headers?.find?.((h: any) => h.key === "type")?.value;
        if (msgType === "card") {
          return origHandle({
            ...data,
            headers: data.headers.map((h: any) =>
              h.key === "type" ? { ...h, value: "event" } : h
            ),
          });
        }
        return origHandle(data);
      };
    }

    return new Promise<void>((resolve, reject) => {
      if (abortSignal?.aborted) {
        this.disconnect();
        return resolve();
      }
      abortSignal?.addEventListener("abort", () => {
        this.disconnect();
        resolve();
      }, { once: true });

      try {
        void this.wsClient!.start({ eventDispatcher: dispatcher });
      } catch (err) {
        this.disconnect();
        reject(err);
      }
    });
  }

  disconnect(): void {
    if (this.wsClient) {
      try { this.wsClient.close({ force: true }); } catch { /* ignore */ }
      this.wsClient = null;
    }
  }

  isWSConnected(): boolean {
    return this.wsClient?.getConnectionStatus().state === "connected";
  }

  // ---- Send text (as interactive card with lark_md) ------------------------

  async sendText(
    chatId: string,
    text: string,
    replyTo?: string,
    replyInThread = false,
  ): Promise<string | undefined> {
    return this.sendInteractive(
      chatId,
      buildMarkdownCard(text),
      replyTo,
      replyInThread,
    );
  }

  // ---- Reply (plain text, to a specific message) ---------------------------

  async reply(messageId: string, text: string): Promise<string | undefined> {
    const res = await this.sdk.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
    return res.data?.message_id;
  }

  // ---- Edit message --------------------------------------------------------

  async editMessage(messageId: string, text: string): Promise<void> {
    await this.sdk.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(buildMarkdownCard(text)),
      },
    });
  }

  // ---- Interactive card (buttons) ------------------------------------------

  async sendInteractive(
    chatId: string,
    card: object,
    replyTo?: string,
    replyInThread = false,
  ): Promise<string | undefined> {
    if (replyTo) {
      const res = await this.sdk.im.message.reply({
        path: { message_id: replyTo },
        data: {
          msg_type: "interactive",
          content: JSON.stringify(card),
          reply_in_thread: replyInThread,
        },
      });
      assertApiSuccess(res, "interactive reply");
      return res.data?.message_id;
    }
    const res = await this.sdk.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
    assertApiSuccess(res, "interactive send");
    return res.data?.message_id;
  }

  async updateInteractive(messageId: string, card: object): Promise<void> {
    const res = await this.sdk.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(card),
      },
    });
    assertApiSuccess(res, "interactive update");
  }

  // ---- Download message resource (image/file) ------------------------------

  async downloadResource(
    messageId: string,
    fileKey: string,
    type: "image" | "file",
  ): Promise<Buffer> {
    const res = await this.sdk.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    });
    const resAny = res as any;

    // Lark SDK returns { writeFile, getReadableStream, headers }
    // Use getReadableStream() to get the binary data
    if (typeof resAny.getReadableStream === "function") {
      const stream = resAny.getReadableStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }

    // Fallback: try writeFile to a temp path and read back
    if (typeof resAny.writeFile === "function") {
      const os = await import("node:os");
      const fs = await import("node:fs/promises");
      const tmpPath = `${os.tmpdir()}/feishu-dl-${fileKey}-${Date.now()}`;
      await resAny.writeFile(tmpPath);
      const buf = await fs.readFile(tmpPath);
      await fs.rm(tmpPath, { force: true });
      return buf;
    }

    throw new Error(`downloadResource: unexpected response type for ${fileKey}, keys=${Object.keys(resAny ?? {}).join(",")}`);
  }
}
