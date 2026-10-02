/* Minimal SMTP client for Cloudflare Workers (TCP sockets).
   Used to send from a Gmail account with a Gmail app password:
   host smtp.gmail.com, port 465, implicit TLS ("on").
   Port 587 uses STARTTLS ("starttls"). "off" is plain text and is only allowed for local tests.
   The password is read from the SMTP_PASSWORD secret and is never logged. */
import { connect } from "cloudflare:sockets";

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(text) {
  const bytes = enc.encode(text);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function wrap76(s) {
  return s.replace(/.{1,76}/g, "$&\r\n").replace(/\r\n$/, "");
}

function encodeHeader(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : "=?UTF-8?B?" + b64(text) + "?=";
}

class Conn {
  constructor(socket) {
    this.setSocket(socket);
    this.buf = "";
  }
  setSocket(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }
  async reply() {
    for (;;) {
      const lines = this.buf.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const text = lines.slice(0, i + 1).join("\n");
          this.buf = lines.slice(i + 1).join("\r\n");
          return { code: parseInt(lines[i].slice(0, 3), 10), text };
        }
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("SMTP connection closed");
      this.buf += dec.decode(value, { stream: true });
    }
  }
  async send(line) {
    await this.writer.write(enc.encode(line + "\r\n"));
  }
  async cmd(line, expect) {
    await this.send(line);
    const r = await this.reply();
    if (!expect.includes(r.code)) {
      const safe = line.startsWith("AUTH") ? "AUTH" : line.split(" ")[0];
      throw new Error("SMTP " + safe + " failed with " + r.code);
    }
    return r;
  }
}

export function buildMessage({ fromName, from, to, replyTo, subject, text, html }) {
  const boundary = "tv_" + crypto.randomUUID().replace(/-/g, "");
  const domain = from.split("@")[1] || "localhost";
  const headers = [
    "From: " + encodeHeader(fromName) + " <" + from + ">",
    "To: <" + to + ">",
    replyTo ? "Reply-To: <" + replyTo + ">" : null,
    "Subject: " + encodeHeader(subject),
    "Date: " + new Date().toUTCString().replace("GMT", "+0000"),
    "Message-ID: <" + crypto.randomUUID() + "@" + domain + ">",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="' + boundary + '"'
  ].filter(Boolean);
  const body = [
    "--" + boundary,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(text)),
    "--" + boundary,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(html)),
    "--" + boundary + "--",
    ""
  ];
  return headers.join("\r\n") + "\r\n\r\n" + body.join("\r\n");
}

export async function smtpSend(opts, message) {
  const { host, port, secure, user, pass, from, to, heloName } = opts;
  const mode = secure === "on" ? "on" : secure === "off" ? "off" : "starttls";
  const socket = connect({ hostname: host, port }, { secureTransport: mode, allowHalfOpen: false });
  const c = new Conn(socket);
  try {
    let r = await c.reply();
    if (r.code !== 220) throw new Error("SMTP greeting failed with " + r.code);
    await c.cmd("EHLO " + heloName, [250]);
    if (mode === "starttls") {
      await c.cmd("STARTTLS", [220]);
      c.reader.releaseLock();
      c.writer.releaseLock();
      c.setSocket(socket.startTls());
      await c.cmd("EHLO " + heloName, [250]);
    }
    if (user && pass) {
      await c.cmd("AUTH PLAIN " + b64("\u0000" + user + "\u0000" + pass), [235]);
    }
    await c.cmd("MAIL FROM:<" + from + ">", [250]);
    await c.cmd("RCPT TO:<" + to + ">", [250, 251]);
    await c.cmd("DATA", [354]);
    const stuffed = message.replace(/\r\n\./g, "\r\n..");
    await c.writer.write(enc.encode(stuffed + "\r\n.\r\n"));
    r = await c.reply();
    if (r.code !== 250) throw new Error("SMTP DATA failed with " + r.code);
    try {
      await c.send("QUIT");
    } catch (e) {}
  } finally {
    try {
      await socket.close();
    } catch (e) {}
  }
}
