// The mailer sends only when email is set up, says what happened, and never throws.
// A tiny SMTP server on this computer stands in for the real mail server.
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consultationInbox, privacyContact, sendMail } from "@/lib/notify/mailer";

let server: net.Server;
let port = 0;
const received: string[] = [];

beforeAll(async () => {
  server = net.createServer((sock) => {
    let data = "";
    let inData = false;
    sock.write("220 test ESMTP\r\n");
    sock.on("data", (chunk) => {
      const text = chunk.toString();
      if (inData) {
        data += text;
        if (data.endsWith("\r\n.\r\n")) { inData = false; received.push(data); data = ""; sock.write("250 queued\r\n"); }
        return;
      }
      for (const line of text.split("\r\n").filter(Boolean)) {
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250 test\r\n");
        else if (cmd === "MAIL" || cmd === "RCPT") sock.write("250 ok\r\n");
        else if (cmd === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (cmd === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as net.AddressInfo).port;
});
afterAll(() => { server.close(); });

const env = (o: Record<string, string | undefined>) => { for (const k of ["SMTP_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "CONSULTATION_INBOX_EMAIL", "PRIVACY_CONTACT_EMAIL"]) delete process.env[k]; for (const [k, v] of Object.entries(o)) if (v !== undefined) process.env[k] = v; };

describe("mailer", () => {
  it("does nothing, and says so, when email is not set up", async () => {
    env({});
    expect(await sendMail({ to: "inbox@primus.example", subject: "s", text: "t" })).toBe("not_configured");
    env({ SMTP_HOST: "127.0.0.1" });
    expect(await sendMail({ to: "inbox@primus.example", subject: "s", text: "t" })).toBe("not_configured");
  });

  it("sends through the configured server", async () => {
    env({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), MAIL_FROM: "Primus <no-reply@primus.example>" });
    expect(await sendMail({ to: "inbox@primus.example", subject: "Consultation request: Orchid Hill", text: "Mobile: +919876543210", replyTo: "asha@orchidhill.example" })).toBe("sent");
    expect(received).toHaveLength(1);
    expect(received[0]).toContain("Subject: Consultation request: Orchid Hill");
    expect(received[0]).toContain("Mobile: +919876543210");
    expect(received[0]).toContain("Reply-To: asha@orchidhill.example");
  });

  it("reports a failure instead of throwing when the server cannot be reached", async () => {
    env({ SMTP_URL: "smtp://127.0.0.1:1", MAIL_FROM: "no-reply@primus.example" });
    expect(await sendMail({ to: "inbox@primus.example", subject: "s", text: "t" })).toBe("failed");
  });

  it("the inbox and the privacy contact come from settings, and the contact falls back to the inbox", () => {
    env({});
    expect(consultationInbox()).toBeNull();
    expect(privacyContact()).toBeNull();
    env({ CONSULTATION_INBOX_EMAIL: "consult@primus.example" });
    expect(consultationInbox()).toBe("consult@primus.example");
    expect(privacyContact()).toBe("consult@primus.example");
    env({ CONSULTATION_INBOX_EMAIL: "consult@primus.example", PRIVACY_CONTACT_EMAIL: "privacy@primus.example" });
    expect(privacyContact()).toBe("privacy@primus.example");
    env({});
  });
});
